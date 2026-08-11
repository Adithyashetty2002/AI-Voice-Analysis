import os
import json
import logging
import re
import requests
import base64
from typing import List, Dict, Any
from pydub import AudioSegment
from pydub.generators import Sine

logger = logging.getLogger("stage5_evaluation")

def extract_pii_local(transcript_text: str) -> List[str]:
    """
    Uses the local `openai/privacy-filter` 1.5B model to extract PII.
    Returns a list of exact string matches from the text.
    """
    try:
        import torch
        from transformers import pipeline
        
        logger.info("Loading local openai/privacy-filter model for PII extraction...")
        
        device = 0 if torch.cuda.is_available() else -1
        
        pii_pipeline = pipeline(
            "token-classification",
            model="openai/privacy-filter",
            aggregation_strategy="simple",
            device=device,
            trust_remote_code=True
        )
        
        if isinstance(transcript_text, list):
            # Replace empty strings with a space to prevent pipeline crash
            safe_texts = [t if t.strip() else " " for t in transcript_text]
            results = pii_pipeline(safe_texts)
        else:
            if not transcript_text.strip():
                return []
            results = pii_pipeline(transcript_text)
        
        # Free VRAM immediately
        del pii_pipeline
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            
        return results
    except Exception as e:
        logger.error(f"Failed to run local PII extraction: {e}")
        return []

def beep_audio(audio_path: str, output_path: str, beep_timestamps: List[Dict[str, float]]):
    """
    Applies a 1000Hz sine wave beep over the audio at the specified timestamps.
    """
    if not os.path.exists(audio_path):
        return
        
    try:
        audio = AudioSegment.from_wav(audio_path)
        beep_gen = Sine(1000)
        
        for ts in beep_timestamps:
            start_ms = int(ts["start"] * 1000)
            end_ms = int(ts["end"] * 1000)
            duration = end_ms - start_ms
            if duration <= 0:
                continue
                
            # -10.5 dBFS is approximately 30% linear amplitude
            beep_segment = beep_gen.to_audio_segment(duration=duration, volume=-10.5)
            audio = audio[:start_ms] + beep_segment + audio[end_ms:]
            
        audio.export(output_path, format="wav")
    except Exception as e:
        logger.error(f"Failed to beep audio {audio_path}: {e}")

def encode_audio_base64(audio_path: str) -> str:
    """Encodes a wav file to base64 for Audio LLM."""
    with open(audio_path, "rb") as audio_file:
        return base64.b64encode(audio_file.read()).decode("utf-8")

def perform_evaluations(scrubbed_turns: List[Dict], session_audio_dir: str, export_data_dir: str, api_keys: Dict[str, str], pre_eval_emotions: Dict[str, Any] = None) -> Dict[str, Any]:
    from openai import OpenAI
    openai_key = api_keys.get("OPENAI", "")
    
    client = OpenAI(api_key=openai_key)
    
    transcript_text = "\n".join([f"{t['speaker']}: {t['text']}" for t in scrubbed_turns])
    
    results = {}
    if pre_eval_emotions:
        results["speaker_emotions"] = pre_eval_emotions
    
    # Prompts setup
    prompts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
    os.makedirs(prompts_dir, exist_ok=True)
    
    sys_path = os.path.join(prompts_dir, "system.md")
    user_path = os.path.join(prompts_dir, "user.md")
    
    if not os.path.exists(sys_path):
        default_sys = """You are an expert transcript evaluator and quality assurance analyst.
Your task is to analyze the provided customer transcript and the provided audio to generate a final report.
CRITICAL: You must base your evaluation STRICTLY on the provided transcript and audio. Do not hallucinate facts.
First, identify which speaker in the transcript represents the support Agent, and extract their name if they introduce themselves. If their name is not mentioned, use "Unknown Agent".

Return your response strictly as a JSON object with the following keys:
- "agent_speaker_label": string (e.g., "SPEAKER_00" or "SPEAKER_01", representing the agent)
- "agent_name": string (the agent's name, or "Unknown Agent")
- "issue_resolved": string ("Yes" or "No")
- "understandability": integer (0-100)
- "knowledgeable": integer (0-100)
- "empathy": integer (0-100)
- "personal_info_remaining": string ("Yes" or "No")
"""
        with open(sys_path, "w", encoding="utf-8") as f:
            f.write(default_sys)
            
    if not os.path.exists(user_path):
        default_user = """Please evaluate the following transcript according to the system instructions.

Transcript:
{transcript_text}"""
        with open(user_path, "w", encoding="utf-8") as f:
            f.write(default_user)
            
    with open(sys_path, "r", encoding="utf-8") as f:
        sys_prompt = f.read()
        
    with open(user_path, "r", encoding="utf-8") as f:
        user_template = f.read()
        
    user_prompt = user_template.replace("{transcript_text}", transcript_text)
        
    # Load and encode the master beeped audio
    master_audio_path = os.path.join(session_audio_dir, "beeped_input.wav")
    base64_audio = ""
    if os.path.exists(master_audio_path):
        base64_audio = encode_audio_base64(master_audio_path)
        
    try:
        if False: # Disable audio model to force gpt-4o-mini json_object output
            messages = [
                {"role": "user", "content": [
                    {"type": "text", "text": f"{sys_prompt}\n\n{user_prompt}"},
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": base64_audio,
                            "format": "wav"
                        }
                    }
                ]}
            ]
            try:
                r1 = client.chat.completions.create(
                    model="gpt-4o-audio-preview",
                    modalities=["text"],
                    messages=messages,
                    temperature=0.1
                )
            except Exception as audio_err:
                logger.warning(f"Audio model failed ({audio_err}), falling back to text-only.")
                base64_audio = "" # Force text-only fallback below
                
        if True: # Force text-only gpt-4o-mini always
            messages = [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt}
            ]
            r1 = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.1
            )
            
        content = r1.choices[0].message.content
        content = content.replace("```json", "").replace("```", "").strip()
        transcript_eval = json.loads(content)
        
        if "speaker_emotions" in transcript_eval:
            results["speaker_emotions"] = transcript_eval["speaker_emotions"]
            for spk, data in results["speaker_emotions"].items():
                if "all_emotions" in data:
                    all_emotions = data["all_emotions"]
                    if all_emotions:
                        primary = max(all_emotions, key=all_emotions.get)
                        data["emotion"] = primary
                        data["confidence"] = 100
                        data["frustration"] = all_emotions.get("Frustration", 0)
        
        results["transcript_evaluation"] = transcript_eval
    except Exception as e:
        logger.error(f"Failed to generate scorecard evaluation: {e}")
            
    return results

def extract_agent_info(raw_turns: List[Dict], openai_key: str) -> Dict[str, str]:
    if not openai_key:
        return {}
    try:
        from openai import OpenAI
        client = OpenAI(api_key=openai_key)
        transcript_text = "\n".join([f"{t['speaker']}: {t['text']}" for t in raw_turns])
        
        sys_prompt = """You are an expert conversational analyst.
Read the transcript and identify which speaker is the Support Agent, and extract their name.
If the agent introduces themselves, extract the name. Otherwise, use "Unknown Agent".
Return strictly a JSON object with:
- "agent_speaker_label": string (e.g., "SPEAKER_00" or "SPEAKER_01")
- "agent_name": string (the agent's name, or "Unknown Agent")"""

        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": f"Transcript:\n{transcript_text}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )
        content = r.choices[0].message.content
        return json.loads(content)
    except Exception as e:
        logger.error(f"Failed to extract agent info: {e}")
        return {}

def run_stage5(raw_turns: List[Dict], session_audio_dir: str, export_data_dir: str, api_keys: Dict[str, str]):
    logger.info("Starting Stage 5: PII Scrubbing and Final Evaluations")
    
    # --- PHASE 1: Pre-scrub Emotional Analysis using Smallest AI (Audio) ---
    pre_eval_emotions = {}
    try:
        import requests
        smallest_key = api_keys.get("SMALLEST_AI", "")
        
        speakers = list(set([t["speaker"] for t in raw_turns]))
        
        for spk in speakers:
            orig_spk_audio = os.path.join(session_audio_dir, f"speaker_{spk}_full.wav")
            if not os.path.exists(orig_spk_audio):
                logger.warning(f"Audio file not found for {spk}, skipping emotion analysis.")
                continue
                
            logger.info(f"Running pre-scrub Smallest AI emotion evaluation for speaker {spk} via Pulse STT...")
            url = "https://api.smallest.ai/waves/v1/stt/?model=pulse&language=en&emotion_detection=true"
            headers = {
                "Authorization": f"Bearer {smallest_key}",
                "Content-Type": "audio/wav"
            }
            
            with open(orig_spk_audio, "rb") as f:
                audio_data = f.read()
                
            resp = requests.post(url, headers=headers, data=audio_data)
            
            if resp.status_code == 200:
                resp_json = resp.json()
                emotions = resp_json.get("emotions", {})
                
                primary_emotion = "N/A"
                confidence = 0
                frustration = 0
                all_emotions = {}
                
                if emotions:
                    primary_emotion = max(emotions, key=emotions.get)
                    confidence = int(emotions.get(primary_emotion, 0) * 100)
                    frustration = int(min((emotions.get("anger", 0) + emotions.get("disgust", 0)) * 100, 100))
                    primary_emotion = primary_emotion.capitalize()
                    
                    for k, v in emotions.items():
                        all_emotions[k.capitalize()] = int(v * 100)
                    all_emotions = dict(sorted(all_emotions.items(), key=lambda item: item[1], reverse=True))
                    
                pre_eval_emotions[spk] = {
                    "emotion": primary_emotion,
                    "confidence": confidence,
                    "frustration": frustration,
                    "all_emotions": all_emotions
                }
            else:
                logger.error(f"Smallest AI Pulse STT failed: {resp.status_code} - {resp.text}")
                
    except Exception as e:
        logger.error(f"Pre-scrub Smallest AI evaluation failed: {e}")

    # --- PHASE 1.5: Identify Agent from raw unscrubbed turns ---
    agent_info = extract_agent_info(raw_turns, api_keys.get("OPENAI", ""))

    # --- PHASE 2: PII Scrubbing ---
    
    # 1. Prepare turn texts and word mappings
    turn_texts = []
    all_word_mappings = [] # List of lists of mappings per turn
    
    for turn in raw_turns:
        turn_text = ""
        mappings = []
        if turn.get("raw_word_timestamps"):
            for w in turn["raw_word_timestamps"]:
                w_start = len(turn_text)
                turn_text += w["word"] + " "
                w_end = len(turn_text) - 1
                mappings.append({
                    "word_dict": w,
                    "c_start": w_start,
                    "c_end": w_end
                })
            turn_text = turn_text.rstrip() # Remove trailing space
        else:
            turn_text = turn.get("text", "")
            
        turn_texts.append(turn_text)
        all_word_mappings.append(mappings)
        
    # 2. Extract PII per turn in a batch using the local model
    logger.info(f"Running PII extraction on {len(turn_texts)} turns.")
    batch_entities = extract_pii_local(turn_texts)
    
    # Handle the case where pipeline returns a single list for a 1-element input
    if len(turn_texts) == 1 and batch_entities and isinstance(batch_entities[0], dict):
        batch_entities = [batch_entities]
    elif not batch_entities:
        batch_entities = [[] for _ in turn_texts]

    beep_timestamps = []
    scrubbed_turns = []
    
    # 3. Process each turn with reverse-sorted string modification
    for i, turn in enumerate(raw_turns):
        turn_text = turn_texts[i]
        mappings = all_word_mappings[i]
        entities = batch_entities[i] if i < len(batch_entities) else []
        
        turn_beep_ts = []
        if entities and mappings:
            for entity in entities:
                e_start = entity.get("start", 0)
                e_end = entity.get("end", 0)
                
                # Find overlapping words to generate audio beeps
                for mapping in mappings:
                    w_start = mapping["c_start"]
                    w_end = mapping["c_end"]
                    if max(w_start, e_start) < min(w_end, e_end):
                        w_dict = mapping["word_dict"]
                        turn_beep_ts.append({"start": w_dict["start"], "end": w_dict["end"]})
                        beep_timestamps.append({"start": w_dict["start"], "end": w_dict["end"]})
                        e_label = entity.get("entity_group", "BEEP")
                        w_dict["word"] = f"[{e_label}]"
                        
        # The key to preventing missed redactions across a long transcript is sorting 
        # the entity spans in reverse order before string modification!
        entities.sort(key=lambda x: x.get("start", 0), reverse=True)
        
        redacted_text = turn_text
        for entity in entities:
            e_start = entity.get("start", 0)
            e_end = entity.get("end", 0)
            # Use the taxonomy category like [PRIVATE_PERSON], default to [BEEP]
            e_label = entity.get("entity_group", "BEEP")
            
            # String modification in reverse order preserves character offsets for preceding matches
            redacted_text = redacted_text[:e_start] + f"[{e_label}]" + redacted_text[e_end:]
            
        turn["text"] = redacted_text
        turn["turn_beep_ts"] = turn_beep_ts
        scrubbed_turns.append(turn)

    # We need to beep the individual speaker full audio files and save them as speaker_X_beeped.wav
    speakers = list(set([t["speaker"] for t in raw_turns]))
    for spk in speakers:
        orig_spk_audio = os.path.join(session_audio_dir, f"speaker_{spk}_full.wav")
        beeped_spk_audio = os.path.join(session_audio_dir, f"speaker_{spk}_beeped.wav")
        
        # We need local timestamps for the concatenated file
        # The raw_turns has global timestamps. In pipeline.py we mapped local to global.
        # But wait, in stage 5 we don't have the local mapping easily available.
        # It's better to beep the GLOBAL standardized audio, then re-slice?
        # No, pipeline.py can just beep the standardized audio and then re-export the speaker streams.
        # Let's let pipeline.py handle audio beeping using the beep_timestamps.
        pass

    # Actually, if we just beep the global standardized audio in pipeline.py, 
    # we can re-slice it there. Let's return the timestamps.
    
    evaluation_results = {}
    openai_key = api_keys.get("OPENAI")
    if openai_key:
        # We will require pipeline.py to generate speaker_X_beeped.wav BEFORE calling perform_evaluations
        # We can use a wrapper to pass pre_eval_emotions to perform_evaluations
        def evaluation_wrapper(scrubbed, audio_dir, export_dir, keys):
            res = perform_evaluations(scrubbed, audio_dir, export_dir, keys, pre_eval_emotions)
            if "transcript_evaluation" in res:
                res["transcript_evaluation"].update(agent_info)
            else:
                res["transcript_evaluation"] = agent_info
            return res
    
    return {
        "scrubbed_turns": scrubbed_turns,
        "pii_beep_timestamps": beep_timestamps,
        "evaluation_func": evaluation_wrapper
    }
