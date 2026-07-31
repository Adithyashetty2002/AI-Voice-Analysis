import torch
import torchaudio

_original_torchaudio_load = torchaudio.load
def _patched_torchaudio_load(*args, **kwargs):
    kwargs["backend"] = "soundfile"
    return _original_torchaudio_load(*args, **kwargs)
torchaudio.load = _patched_torchaudio_load

try:
    torchaudio.load("static/audio/2ac66101-1173-441a-bac3-b4cc19542258/normalized_input.wav")
    print("SUCCESS")
except Exception as e:
    import traceback
    traceback.print_exc()
