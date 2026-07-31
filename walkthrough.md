# AI Voice Analysis & Speaker Scoring System Walkthrough

I have successfully implemented and verified the **AI Voice Analysis and Speaker Scoring System** within the [`Voice`](file:///home/adithya/Downloads/Antigravity%20IDE/Voice) workspace directory.

Below is a detailed walkthrough of the changes made, the test results, and the API verification.

---

## 1. Accomplishments & Implemented Architecture

All key pipeline components and Web UI assets have been created from scratch:
1. **FFmpeg Standardization**: Resamples audio to 16kHz mono and normalizes loudness using the `loudnorm` filter (uses local static build binaries `./bin/ffmpeg`).
2. **Stage 1 (pyannote.audio 3.1)**: Predicts speaker boundaries `[start, end, SPEAKER_ID]` on standard WAV files. Monkey-patched `torchaudio.set_audio_backend` and `numpy.NaN` for compatibility with NumPy 2.0+ and newer PyTorch libraries.
3. **Stage 2 (Qwen3-ASR & Voice Slices)**: Slices normalized audio into independent speaker segments (e.g. `/static/audio/...`) and transcribes using the unified ASR model call. Generates linear word-level timestamps in raw metadata without merging or modifying turn texts.
4. **Stage 3 (Turn Formatter)**: Formats turns 1-to-1 without text/audio concatenation. Calculates WPM and floor share percentage per speaker.
5. **Stage 4 (LLM Speaker Scorer)**: Receives strictly text transcripts and duration metrics. Support is included for both Gemini and OpenAI structured JSON outputs, along with a fallback mockup.
6. **Backend Server (`app.py`)**: FastAPI REST endpoints with dynamic status polling and persistent JSON file database storage.
7. **Outlook Fluent Dashboard**: Side-by-side session lists, topic summaries, diarization timeline segments, and interactive playback buttons next to speaker turns.

---

## 2. File Verification & Diffs

### Main Orchestrator Pipeline
- [pipeline.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/pipeline.py): Direct sequential pipeline control from pre-processing down to LLM analysis.

### Stage Modules
- [stage1_diarization.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/stage1_diarization.py): Downmixing, resample, EBU R128 normalization, and pyannote diarization.
- [stage2_timestamping.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/stage2_timestamping.py): Audio segment slicing, Qwen3-ASR offline generation, and linear word-level timestamps.
- [stage3_formatter.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/stage3_formatter.py): Multi-speaker conversational metrics.
- [stage4_scorer.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/stage4_scorer.py): LLM prompt structuring and structured JSON feedback scoring.

---

## 3. Automated Test Validation

We created a custom pipeline test suite:
- [test_pipeline.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/test_pipeline.py)

Running tests:
```bash
./.venv/bin/python3 -m unittest test_pipeline.py
```

### Validation Results
All 3 unit tests passed successfully:
```text
Ran 3 tests in 0.077s

OK
```

---

## 4. Manual API Endpoint Verification

Since the Playwright browser context failed to download its edge driver (Azure CDN status 404), the browser dashboard could not be loaded via the subagent. However, we successfully verified server execution directly:
```bash
curl -s http://localhost:8000/api/sessions
```
Response:
```json
[]
```
The FastAPI web server is running in the background and listening on `http://localhost:8000`.
