import os
import uuid
import logging
import traceback
import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, message=".*ffmpeg or avconv.*")
from pydub import AudioSegment
from dotenv import load_dotenv, find_dotenv

# Import stages
from stage1_diarization import preprocess_audio, DiarizationPipeline
from stage2_timestamping import ASRTimestampPipeline
from stage3_formatter import format_speaker_turns

from stage5_evaluation import run_stage5, beep_audio

logger = logging.getLogger("pipeline")

class VoiceAnalysisPipeline:
    def __init__(self, hf_token: str = None, device: str = "cuda:0"):
        """
        Initializes the entire pipeline with FunASR and Qwen3-ASR models.
        """
        # Load environment overrides
        env_file = find_dotenv(usecwd=True)
        if env_file:
            load_dotenv(env_file, override=True)
        else:
            load_dotenv(override=True)
            
        gpu_device = os.getenv("GPU_DEVICE", device)
        logger.info(f"Pipeline device selected: {gpu_device}")
        
        self.diarization_model = None
        self.asr_model = None
        self.device = gpu_device



    def analyze_audio(self, session_id: str, raw_audio_path: str, topic: str, output_base_dir: str, progress_callback=None) -> dict:
        """
        Runs the full 5-stage sequential voice analysis pipeline.
        - progress_callback: a function accepting (message: str, percentage: int)
        """
        session_audio_dir = os.path.join(output_base_dir, "audio", session_id)
        os.makedirs(session_audio_dir, exist_ok=True)
        
        # Standardized Wav path
        standardized_wav_path = os.path.join(session_audio_dir, "normalized_input.wav")
        
        try:
            # 1. Pre-processing stage
            if progress_callback:
                progress_callback("Standardizing audio file layout & normalizing loudness...", 10)
            
            preprocess_audio(raw_audio_path, standardized_wav_path)
            
            # Determine total duration of standardized WAV
            audio = AudioSegment.from_wav(standardized_wav_path)
            total_duration = len(audio) / 1000.0  # seconds
            logger.info(f"Input audio duration: {total_duration:.2f} seconds.")
            
            # Load ONLY the diarization model to save VRAM
            if progress_callback:
                progress_callback("Loading Pyannote diarization model...", 20)
            if self.diarization_model is None:
                hf_token = os.getenv("HF_TOKEN")
                self.diarization_model = DiarizationPipeline(hf_token=hf_token, device=self.device)
            
            # 2. Stage 1: Diarization
            if progress_callback:
                progress_callback("Stage 1: Conducting speaker diarization (who spoke when)...", 35)
            
            diarized_segments = self.diarization_model.run(standardized_wav_path)
            
            if not diarized_segments:
                logger.warning("No speech segments detected in audio file.")
                import torch
                del self.diarization_model
                self.diarization_model = None
                if torch.cuda.is_available(): torch.cuda.empty_cache()
                return {
                    "status": "no_speech_detected",
                    "message": "No human speech detected in the audio file.",
                    "topic": topic,
                    "metrics": {
                        "total_audio_duration_seconds": round(total_duration, 2),
                        "total_talking_duration_seconds": 0.0,
                        "speaker_statistics": {}
                    },
                    "turns": [],
                    "scorecard": None
                }
                
            # 3. Stage 2: Segment Transcription & Slicing
            if progress_callback:
                progress_callback("Stage 2: Transcribing specific speakers and saving voice clips...", 55)
                

            # We will gather audio per speaker and then transcribe the whole speaker audio.
            if progress_callback:
                progress_callback("Stage 2: Transcribing aggregated speaker audio with Whisper...", 60)
            
            speaker_audio_segments = {}
            audio = AudioSegment.from_wav(standardized_wav_path)
            
            # Aggregate audio per speaker (tight concatenation without silence gaps)
            for idx, seg in enumerate(diarized_segments):
                start = seg["start"]
                end = seg["end"]
                spk = seg["speaker"]
                
                start_ms = int(start * 1000)
                end_ms = int(end * 1000)
                sliced = audio[start_ms:end_ms]
                
                if spk not in speaker_audio_segments:
                    speaker_audio_segments[spk] = sliced
                else:
                    speaker_audio_segments[spk] += sliced
                    
            export_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "sessions")
            os.makedirs(export_data_dir, exist_ok=True)
            
            import json
            diarization_json_path = os.path.join(export_data_dir, f"{session_id}_diarization.json")
            with open(diarization_json_path, "w", encoding="utf-8") as f:
                json.dump(diarized_segments, f, indent=4)
                
            # Free VRAM: unload Diarization model, load ASR model
            import torch
            del self.diarization_model
            self.diarization_model = None
            if torch.cuda.is_available(): torch.cuda.empty_cache()
            
            if self.asr_model is None:
                self.asr_model = ASRTimestampPipeline(device=self.device)
                
            speaker_transcriptions = {}
            
            for idx, (spk, aud) in enumerate(speaker_audio_segments.items()):
                spk_filename = f"{session_id}_speaker_{spk}_full.wav"
                dst_audio = os.path.join(export_data_dir, spk_filename)
                
                # Also save to static audio dir for web playback
                static_audio = os.path.join(session_audio_dir, f"speaker_{spk}_full.wav")
                aud.export(static_audio, format="wav")
                
                import shutil
                shutil.copy2(static_audio, dst_audio)
                
                # Transcribe the ENTIRE speaker audio
                if progress_callback:
                    percent = int(60 + (30 * (idx + 1) / len(speaker_audio_segments)))
                    progress_callback(f"Transcribing full audio for speaker {spk}...", percent)
                    
                segment_words = self.asr_model.transcribe_segment(static_audio)
                text = " ".join([w["word"] for w in segment_words]).strip()
                
                spk_data = {
                    "speaker": spk,
                    "text": text,
                    "voice_clip_url": f"/static/audio/{session_id}/speaker_{spk}_full.wav",
                    "words": segment_words
                }
                speaker_transcriptions[spk] = spk_data

            # Free VRAM: unload ASR model since it's no longer needed
            del self.asr_model
            self.asr_model = None
            if torch.cuda.is_available(): torch.cuda.empty_cache()

            # --- RE-ALIGNMENT ALGORITHM ---
            # Map words from the concatenated audio back to the original diarization timeline
            speaker_chunks = {}
            for seg in diarized_segments:
                spk = seg["speaker"]
                if spk not in speaker_chunks:
                    speaker_chunks[spk] = []
                speaker_chunks[spk].append({
                    "orig_start": seg["start"],
                    "orig_end": seg["end"],
                    "duration": seg["end"] - seg["start"],
                    "confidence": seg.get("confidence", 1.0),
                    "words": []
                })
                
            for spk, chunks in speaker_chunks.items():
                current_time = 0.0
                for chunk in chunks:
                    chunk["concat_start"] = current_time
                    chunk["concat_end"] = current_time + chunk["duration"]
                    current_time += chunk["duration"]
                    
            for spk, data in speaker_transcriptions.items():
                words = data["words"]
                chunks = speaker_chunks[spk]
                
                mapped_global_words = []
                
                for w in words:
                    w_start = w.get("start", 0)
                    w_end = w.get("end", 0)
                    w_mid = (w_start + w_end) / 2.0
                    
                    best_chunk = None
                    for chunk in chunks:
                        if w_mid >= chunk["concat_start"] and w_mid <= chunk["concat_end"]:
                            best_chunk = chunk
                            break
                            
                    if not best_chunk:
                        # Fallback to nearest chunk if midpoint slightly misses a boundary
                        best_chunk = min(chunks, key=lambda c: min(abs(w_mid - c["concat_start"]), abs(w_mid - c["concat_end"])))
                        
                    offset = best_chunk["orig_start"] - best_chunk["concat_start"]
                    mapped_word = {
                        "word": w["word"],
                        "start": round(w_start + offset, 3),
                        "end": round(w_end + offset, 3)
                    }
                    best_chunk["words"].append(mapped_word)
                    mapped_global_words.append(mapped_word)
            original_audio = AudioSegment.from_wav(standardized_wav_path)
            
            raw_turns = []
            for spk, chunks in speaker_chunks.items():
                for idx, chunk in enumerate(chunks):
                    text = " ".join([w["word"] for w in chunk["words"]]).strip()
                    
                    # Slice the original audio for just this turn
                    start_ms = int(chunk["orig_start"] * 1000)
                    end_ms = int(chunk["orig_end"] * 1000)
                    turn_audio = original_audio[start_ms:end_ms]
                    
                    turn_filename = f"speaker_{spk}_turn_{idx}.wav"
                    turn_static_path = os.path.join(session_audio_dir, turn_filename)
                    turn_audio.export(turn_static_path, format="wav")
                    
                    raw_turns.append({
                        "speaker": spk,
                        "turn_start": chunk["orig_start"],
                        "turn_end": chunk["orig_end"],
                        "duration_seconds": round(chunk["duration"], 2),
                        "confidence": chunk["confidence"],
                        "text": text,
                        "voice_clip_url": f"/static/audio/{session_id}/{turn_filename}",
                        "raw_word_timestamps": chunk["words"]
                    })
                    
            raw_turns.sort(key=lambda x: x["turn_start"])
            

            # Export UN-SCRUBBED interleaved conversation
            conv_json_path = os.path.join(export_data_dir, f"{session_id}_conversation.json")
            with open(conv_json_path, "w", encoding="utf-8") as f:
                json.dump(raw_turns, f, indent=4)
                
            conv_txt_path = os.path.join(export_data_dir, f"{session_id}_conversation.txt")
            with open(conv_txt_path, "w", encoding="utf-8") as f:
                for turn in raw_turns:
                    f.write(f"[{turn['turn_start']}s - {turn['turn_end']}s] {turn['speaker']} (Confidence: {turn['confidence']}):\n")
                    f.write(f"{turn['text']}\n")
                    if "raw_word_timestamps" in turn:
                        f.write("Word-level timestamps:\n")
                        for w in turn["raw_word_timestamps"]:
                            f.write(f"  [{w.get('start', 0)}s - {w.get('end', 0)}s] {w.get('word', '')}\n")
                    f.write("\n")
            
            # --- Stage 5: Scrubbing PII from text before saving transcripts ---
            api_keys = {
                "OPENAI": os.getenv("OPENAI_API_KEY", ""),
                "SMALLEST_AI": os.getenv("SMALLEST_AI_API_KEY", "")
            }
            if progress_callback:
                progress_callback("Scrubbing PII from text...", 70)
                
            stage5_results = run_stage5(raw_turns, session_audio_dir, export_data_dir, api_keys)
            
            # Export SCRUBBED interleaved conversation
            conv_json_beeped_path = os.path.join(export_data_dir, f"{session_id}_conversation_beeped.json")
            with open(conv_json_beeped_path, "w", encoding="utf-8") as f:
                json.dump(raw_turns, f, indent=4)
                
            conv_txt_beeped_path = os.path.join(export_data_dir, f"{session_id}_conversation_beeped.txt")
            with open(conv_txt_beeped_path, "w", encoding="utf-8") as f:
                for turn in raw_turns:
                    f.write(f"[{turn['turn_start']}s - {turn['turn_end']}s] {turn['speaker']} (Confidence: {turn['confidence']}):\n")
                    f.write(f"{turn['text']}\n")
                    if "raw_word_timestamps" in turn:
                        f.write("Word-level timestamps:\n")
                        for w in turn["raw_word_timestamps"]:
                            f.write(f"  [{w.get('start', 0)}s - {w.get('end', 0)}s] {w.get('word', '')}\n")
                    f.write("\n")


            # 4. Stage 3: Formatting & WPM Metrics
            if progress_callback:
                progress_callback("Stage 3: Compiling speaking statistics and floor share data...", 80)
                
            formatted_data = format_speaker_turns(raw_turns, total_duration)
            

            
            # 6. Stage 5: Audio LLM Evaluations and Beeping
            if progress_callback:
                progress_callback("Stage 5: Running Audio LLM evaluations and beeping audio...", 92)
            
            # Beep the standardized audio based on PII timestamps
            beeped_wav_path = os.path.join(session_audio_dir, "beeped_input.wav")
            beep_audio(standardized_wav_path, beeped_wav_path, stage5_results["pii_beep_timestamps"])
            
            # Create beeped mono tracks for each speaker
            if progress_callback:
                progress_callback("Generating beeped audio tracks for Audio LLM...", 96)
                
            if os.path.exists(beeped_wav_path):
                beeped_audio_full = AudioSegment.from_wav(beeped_wav_path)
                for spk, chunks in speaker_chunks.items():
                    spk_beeped_track = AudioSegment.empty()
                    for idx, chunk in enumerate(chunks):
                        start_ms = int(chunk["orig_start"] * 1000)
                        end_ms = int(chunk["orig_end"] * 1000)
                        sliced = beeped_audio_full[start_ms:end_ms]
                        
                        if idx == 0:
                            spk_beeped_track = sliced
                        else:
                            spk_beeped_track += sliced
                            
                    beeped_dst = os.path.join(session_audio_dir, f"speaker_{spk}_beeped.wav")
                    spk_beeped_track.export(beeped_dst, format="wav")
                    
                    # Copy to data export directory
                    export_beeped_dst = os.path.join(export_data_dir, f"{session_id}_speaker_{spk}_beeped.wav")
                    import shutil
                    shutil.copy2(beeped_dst, export_beeped_dst)
                    
            if os.path.exists(beeped_wav_path):
                import shutil
                export_master_beeped = os.path.join(export_data_dir, f"{session_id}_beeped_input.wav")
                shutil.copy2(beeped_wav_path, export_master_beeped)
                    
            if progress_callback:
                progress_callback("Evaluating Audio and Transcript with LLMs...", 98)
                
            eval_results = stage5_results["evaluation_func"](
                stage5_results["scrubbed_turns"], 
                session_audio_dir, 
                export_data_dir, 
                api_keys
            )
            
            if progress_callback:
                progress_callback("Voice analysis report finalized successfully.", 100)
                    

            return {
                "status": "success",
                "session_id": session_id,
                "topic": topic,
                "metrics": formatted_data["metrics"],
                "turns": formatted_data["turns"],

                "stage5_evaluation": eval_results,
                "scrubbed_turns": stage5_results["scrubbed_turns"]
            }
            
        except Exception as e:
            logger.error(f"Pipeline error: {str(e)}")
            logger.error(traceback.format_exc())
            
            # Ensure VRAM is freed on failure to prevent OOM on subsequent runs
            import torch
            if self.diarization_model is not None:
                del self.diarization_model
                self.diarization_model = None
            if self.asr_model is not None:
                del self.asr_model
                self.asr_model = None
            if torch.cuda.is_available(): 
                torch.cuda.empty_cache()
                
            raise e

    def reevaluate_session(self, session_id: str, topic: str, output_base_dir: str, progress_callback=None) -> dict:
        """
        Skips audio processing (Stages 1 and 2) and re-runs LLM evaluation (Stages 4 and 5) on existing data.
        """
        import json
        session_audio_dir = os.path.join(output_base_dir, "audio", session_id)
        export_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "sessions")
        
        # Load the existing session to get the raw turns
        session_json_path = os.path.join(export_data_dir, f"{session_id}.json")
        if not os.path.exists(session_json_path):
            raise FileNotFoundError(f"Session data not found: {session_json_path}")
            
        with open(session_json_path, "r", encoding="utf-8") as f:
            existing_session = json.load(f)
            
        # The original turns are already formatted by Stage 3 and saved in the JSON.
        # But wait, we need the raw interleaved turns for Stage 5.
        raw_turns_path = os.path.join(export_data_dir, f"{session_id}_conversation.json")
        if os.path.exists(raw_turns_path):
            with open(raw_turns_path, "r", encoding="utf-8") as f:
                raw_turns = json.load(f)
        else:
            raw_turns = existing_session.get("turns", [])
            
        api_keys = {
            "OPENAI": os.getenv("OPENAI_API_KEY", ""),
            "SMALLEST_AI": os.getenv("SMALLEST_AI_API_KEY", "")
        }
        
        try:
            if progress_callback:
                progress_callback("Stage 5: Re-running PII Scrubbing and Emotion evaluations...", 20)
                
            stage5_results = run_stage5(raw_turns, session_audio_dir, export_data_dir, api_keys)


            
            if progress_callback:
                progress_callback("Evaluating Audio and Transcript with LLMs...", 80)
                
            eval_results = stage5_results["evaluation_func"](
                stage5_results["scrubbed_turns"], 
                session_audio_dir, 
                export_data_dir, 
                api_keys
            )
            
            if progress_callback:
                progress_callback("Voice analysis report finalized successfully.", 100)
                
            # Update existing session
            existing_session["topic"] = topic

            existing_session["stage5_evaluation"] = eval_results
            existing_session["scrubbed_turns"] = stage5_results["scrubbed_turns"]
            
            return existing_session
            
        except Exception as e:
            logger.error(f"Re-evaluation error: {str(e)}")
            logger.error(traceback.format_exc())
            raise e
