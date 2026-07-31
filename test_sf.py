import soundfile as sf
import torch
import torchaudio

def _custom_torchaudio_load(filepath, *args, **kwargs):
    data, samplerate = sf.read(filepath, dtype='float32')
    tensor = torch.from_numpy(data)
    if tensor.ndim == 1:
        tensor = tensor.unsqueeze(0)
    else:
        tensor = tensor.t()
    return tensor, samplerate

def _custom_torchaudio_info(filepath, *args, **kwargs):
    class Info:
        pass
    info = Info()
    info.sample_rate = sf.info(filepath).samplerate
    info.num_frames = sf.info(filepath).frames
    info.num_channels = sf.info(filepath).channels
    return info

torchaudio.load = _custom_torchaudio_load
torchaudio.info = _custom_torchaudio_info

import numpy as np
if not hasattr(np, "NaN"): np.NaN = np.nan
import sys, types
if 'torchaudio.backend' not in sys.modules:
    sys.modules['torchaudio.backend'] = types.ModuleType('torchaudio.backend')
if 'torchaudio.backend.common' not in sys.modules:
    tbc = types.ModuleType('torchaudio.backend.common')
    tbc.AudioMetaData = type("AudioMetaData", (), {})
    sys.modules['torchaudio.backend.common'] = tbc
if not hasattr(torchaudio, "set_audio_backend"):
    torchaudio.set_audio_backend = lambda x: None
if not hasattr(torchaudio, "get_audio_backend"):
    torchaudio.get_audio_backend = lambda: "soundfile"

_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs["weights_only"] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

from pyannote.audio import Pipeline
import os
pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
print("PIPELINE LOADED")
res = pipeline("static/audio/2ac66101-1173-441a-bac3-b4cc19542258/normalized_input.wav")
print("RESULT", list(res.itertracks(yield_label=True)))
