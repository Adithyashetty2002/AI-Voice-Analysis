import os
import torch
import logging
import subprocess
from dotenv import load_dotenv, find_dotenv

# Fix numpy 2.x breaking Pyannote/Speechbrain dependencies
import numpy as np
if not hasattr(np, "NaN"): np.NaN = np.nan
if not hasattr(np, "NAN"): np.NAN = np.nan
import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, message=".*ffmpeg or avconv.*")
import sys
import types
import torchaudio

# Monkey-patch torchaudio to use soundfile directly, completely bypassing torchaudio's broken backends
import soundfile as sf
def _patched_torchaudio_load(filepath, frame_offset=0, num_frames=-1, **kwargs):
    # Pass start and frames to soundfile to accurately crop the audio
    data, samplerate = sf.read(filepath, start=frame_offset, frames=num_frames, dtype='float32')
    
    tensor = torch.from_numpy(data)
    if tensor.ndim == 1:
        tensor = tensor.unsqueeze(0)
    else:
        tensor = tensor.t()
    return tensor, samplerate
torchaudio.load = _patched_torchaudio_load

def _patched_torchaudio_info(filepath, *args, **kwargs):
    class Info:
        pass
    info = Info()
    info.sample_rate = sf.info(filepath).samplerate
    info.num_frames = sf.info(filepath).frames
    info.num_channels = sf.info(filepath).channels
    return info
torchaudio.info = _patched_torchaudio_info

# Monkey-patch torch.load to default to weights_only=False to support Pyannote loading in PyTorch 2.6+
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs["weights_only"] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

# Comprehensive mock for missing torchaudio.backend in Torchaudio 2.1+
if 'torchaudio.backend' not in sys.modules:
    tb = types.ModuleType('torchaudio.backend')
    sys.modules['torchaudio.backend'] = tb
    
if 'torchaudio.backend.common' not in sys.modules:
    tbc = types.ModuleType('torchaudio.backend.common')
    class AudioMetaData:
        pass
    tbc.AudioMetaData = AudioMetaData
    sys.modules['torchaudio.backend.common'] = tbc

if not hasattr(torchaudio, "set_audio_backend"):
    torchaudio.set_audio_backend = lambda x: None
if not hasattr(torchaudio, "get_audio_backend"):
    torchaudio.get_audio_backend = lambda: "soundfile"

# Configure pydub to point to our local static FFmpeg/FFprobe binaries if imported
try:
    from pydub import AudioSegment
    local_ffmpeg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "ffmpeg")
    local_ffprobe = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "ffprobe")
    if os.path.exists(local_ffmpeg):
        AudioSegment.converter = local_ffmpeg
    if os.path.exists(local_ffprobe):
        AudioSegment.ffprobe = local_ffprobe
except ImportError:
    pass

import numpy as np
if not hasattr(np, "NaN"):
    np.NaN = np.nan

# Monkey-patch huggingface_hub to convert use_auth_token to token for newer HF versions
import huggingface_hub
import huggingface_hub.file_download
_old_download = huggingface_hub.hf_hub_download
def _patched_download(*args, **kwargs):
    if "use_auth_token" in kwargs:
        kwargs["token"] = kwargs.pop("use_auth_token")
    return _old_download(*args, **kwargs)
huggingface_hub.hf_hub_download = _patched_download
huggingface_hub.file_download.hf_hub_download = _patched_download

from pyannote.audio import Pipeline

logger = logging.getLogger("diarization")

def preprocess_audio(input_path: str, output_path: str) -> str:
    """
    Standardizes input audio using FFmpeg:
    - Downmixes to mono (-ac 1)
    - Resamples to 16kHz (-ar 16000)
    - Performs EBU R128 loudness normalization using the 'loudnorm' audio filter
    """
    logger.info(f"Pre-processing audio: {input_path} -> {output_path}")
    
    # Ensure directory of output path exists
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    # Look for local FFmpeg first, then fallback to system PATH
    ffmpeg_bin = "ffmpeg"
    local_bin = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "ffmpeg")
    if os.path.exists(local_bin):
        ffmpeg_bin = local_bin
    else:
        # Check standard relative path if running from subdir
        local_bin_parent = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bin", "ffmpeg")
        if os.path.exists(local_bin_parent):
            ffmpeg_bin = local_bin_parent
            
    # FFmpeg command for mono, 16kHz, loudness normalized wav conversion
    cmd = [
        ffmpeg_bin, "-y",
        "-i", input_path,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ac", "1",
        "-ar", "16000",
        "-f", "wav",
        output_path
    ]
    
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        logger.info("FFmpeg pre-processing completed successfully.")
        return output_path
    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg command failed with return code {e.returncode}")
        logger.error(f"FFmpeg stdout: {e.stdout}")
        logger.error(f"FFmpeg stderr: {e.stderr}")
        raise RuntimeError(f"FFmpeg preprocessing failed: {e.stderr}")

class DiarizationPipeline:
    def __init__(self, hf_token: str = None, device: str = "cuda:0"):
        """
        Initializes the Pyannote speaker diarization pipeline.
        """
        logger.info("Initializing Pyannote speaker diarization pipeline (speaker-diarization-3.1)...")
        if not hf_token:
            logger.error("No HuggingFace token provided! Pyannote 3.1 requires an HF_TOKEN.")
            raise ValueError("HF_TOKEN is required for pyannote.audio.")
            
        # Determine execution device
        self.device = torch.device(device if "cuda" in device and torch.cuda.is_available() else "cpu")
        logger.info(f"Using device for Pyannote: {self.device}")
        
        try:
            self.pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=hf_token)
            if self.pipeline is None:
                raise RuntimeError("Failed to load pyannote/speaker-diarization-3.1. Please ensure your HF_TOKEN is valid and you have accepted the user conditions on HuggingFace.")
            
            # Reduce batch sizes aggressively to prevent CUDA OOM on machines with heavy background VRAM usage
            if hasattr(self.pipeline, "segmentation_batch_size"):
                self.pipeline.segmentation_batch_size = 2
            if hasattr(self.pipeline, "embedding_batch_size"):
                self.pipeline.embedding_batch_size = 2
                
            self.pipeline.to(self.device)
            logger.info("Pyannote models loaded successfully.")
        except Exception as e:
            logger.error(f"Error loading pyannote pipeline: {str(e)}")
            raise
        
    def run(self, audio_path: str) -> list:
        """
        Runs diarization using pyannote.audio.
        Returns a list of speaker segments: [{"start": float, "end": float, "speaker": str}]
        """
        logger.info(f"Running speaker diarization on {audio_path}...")
        
        try:
            # Pyannote pipeline execution 
            diarization = self.pipeline(audio_path)
            
            # Format output
            raw_turns = []
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                raw_turns.append({
                    "start": round(turn.start, 3),
                    "end": round(turn.end, 3),
                    "speaker": speaker,
                    "confidence": 1.0
                })
                
            # Merge close segments from the same speaker and allow natural overlaps for different speakers
            raw_turns.sort(key=lambda x: x["start"])
            turns = []
            last_by_speaker = {}
            
            for t in raw_turns:
                spk = t["speaker"]
                
                if spk in last_by_speaker:
                    prev = last_by_speaker[spk]
                    # Merge if same speaker and close together (less than 1.0s gap)
                    if t["start"] - prev["end"] < 1.0:
                        prev["end"] = max(prev["end"], t["end"])
                        continue
                
                if t["end"] > t["start"]:
                    turns.append(t)
                    last_by_speaker[spk] = t
            
            turns.sort(key=lambda x: x["start"])
            logger.info(f"Diarization finished. Generated {len(turns)} turns.")
            return turns
            
        except Exception as e:
            logger.error(f"Diarization failed: {str(e)}")
            return []
