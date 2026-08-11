import os
import sys

# Ensure local FFmpeg binaries are in the system PATH for transformers/ffmpeg-python
local_bin = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin")
if os.path.exists(local_bin) and local_bin not in os.environ.get("PATH", ""):
    os.environ["PATH"] = local_bin + os.pathsep + os.environ.get("PATH", "")

import logging
import warnings
import torch
from transformers import pipeline
warnings.filterwarnings("ignore", category=RuntimeWarning, message=".*ffmpeg or avconv.*")
from pydub import AudioSegment

# Set custom paths for pydub to use our local static FFmpeg/FFprobe binaries
local_ffmpeg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "ffmpeg")
local_ffprobe = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "ffprobe")
if os.path.exists(local_ffmpeg):
    AudioSegment.converter = local_ffmpeg
else:
    # Check parent dir (if imported from tests/ or app.py context)
    local_ffmpeg_parent = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bin", "ffmpeg")
    if os.path.exists(local_ffmpeg_parent):
        AudioSegment.converter = local_ffmpeg_parent
        
if os.path.exists(local_ffprobe):
    AudioSegment.ffprobe = local_ffprobe
else:
    local_ffprobe_parent = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bin", "ffprobe")
    if os.path.exists(local_ffprobe_parent):
        AudioSegment.ffprobe = local_ffprobe_parent

logger = logging.getLogger("stage2_timestamping")

class ASRTimestampPipeline:
    def __init__(self, device=None):
        """
        Initializes the Whisper Large V3 ASR model for timestamp generation.
        We use chunks and batching to optimize VRAM on GPUs.
        """
        self.device = device if device else ("cuda:0" if torch.cuda.is_available() else "cpu")
        logger.info(f"Loading Whisper model: openai/whisper-large-v3-turbo on {self.device}...")
        
        # Load the pipeline with word-level timestamps enabled
        self.pipe = pipeline(
            "automatic-speech-recognition",
            model="openai/whisper-large-v3-turbo",
            device=self.device,
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
            return_timestamps="word",
            chunk_length_s=10,  # Process in 10s chunks to drastically reduce O(N^2) eager attention VRAM
            batch_size=1,       # Lowered batch size to prevent OOM (was 4)
            model_kwargs={"attn_implementation": "sdpa"} # (Will fallback to eager for word timestamps)
        )
        logger.info("Whisper Large V3 Turbo model loaded successfully.")

    def transcribe_segment(self, audio_path: str) -> list:
        """
        Transcribes a sliced segment of audio. Prevents context bleeding across speakers.
        Returns a list of dictionaries containing {"word": str, "start": float, "end": float}.
        """
        result = self.pipe(audio_path, generate_kwargs={"condition_on_prev_tokens": False})
        
        word_timestamps = []
        chunks = result.get("chunks", [])
        
        for chunk in chunks:
            word_text = chunk.get("text", "").strip()
            ts = chunk.get("timestamp", (0.0, 0.0))
            
            if not word_text:
                continue
                
            w_start = ts[0] if ts[0] is not None else 0.0
            w_end = ts[1] if ts[1] is not None else w_start + 0.1
            
            word_timestamps.append({
                "word": word_text,
                "start": round(float(w_start), 3),
                "end": round(float(w_end), 3)
            })
            
        return word_timestamps
