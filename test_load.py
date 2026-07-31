import torch
import torchaudio
import numpy as np
if not hasattr(np, "NaN"):
    np.NaN = np.nan

if not hasattr(torchaudio, "set_audio_backend"):
    torchaudio.set_audio_backend = lambda x: None
if not hasattr(torchaudio, "get_audio_backend"):
    torchaudio.get_audio_backend = lambda: "soundfile"

_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    print("PATCH CALLED!", kwargs)
    if kwargs.get("weights_only") is None:
        kwargs["weights_only"] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

print("PyTorch version:", torch.__version__)

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
import os

try:
    hf_token = os.environ.get("HF_TOKEN")
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=hf_token)
    print("Pipeline loaded!")
except Exception as e:
    import traceback
    traceback.print_exc()
