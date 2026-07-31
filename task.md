# Tasks: AI Voice Analysis & Speaker Scoring System

## 1. Setup & Environment Configurations
- [x] Create `requirements.txt` with core packages (`pyannote.audio`, `qwen-asr`, `torch`, `torchaudio`, `fastapi`, `uvicorn`, `google-genai`, `pydantic`, `python-dotenv`, `jinja2`, `python-multipart`, `pydub`, `ffmpeg-python`)
- [x] Create `.env.example` defining HF_TOKEN, GEMINI_API_KEY, OPENAI_API_KEY, GPU_DEVICE, LOG_LEVEL

## 2. Core Processing Pipeline Modules
- [x] Implement FFmpeg Audio Pre-processing module (resample to 16kHz, downmix to mono, and apply standard `loudnorm` loudness normalization)
- [x] Implement `pipeline.py` (Main sequential orchestrator combining pre-processing and Stages 1 to 4)
- [x] Implement `stage1_diarization.py` (Stage 1 speaker diarization utilizing pyannote.audio 3.1)
- [x] Implement `stage2_timestamping.py` (Stage 2 speaker-specific audio slicing & Qwen3-ASR transcription with word-level timestamps)
- [x] Implement `stage3_formatter.py` (Stage 3 speaker turn formatter calculating WPM, duration, and floor share %)
- [x] Implement `stage4_scorer.py` (Stage 4 LLM speaker scoring engine for topic adherence, response quality, and fluency scorecard)

## 3. Backend REST Server
- [x] Implement `app.py` (FastAPI application with file upload, task processing, status websocket/polling, and static resource routing)

## 4. Web Client Dashboard (Outlook UI - Fluent Design)
- [x] Create `static/index.html` (Fluent/Outlook-style dashboard with sidebar and main scorecard view)
- [x] Create `static/styles.css` (Fluent design styles, dark mode toggle support, glassmorphism)
- [x] Create `static/app.js` (WebRTC/Audio upload, real-time progress logging, audio player playback sync)

## 5. Testing & Verification
- [x] Write and run automated tests for FFmpeg transcoding and segmentation
- [x] Write and run automated tests for pyannote.audio 3.1 diarization output
- [x] Perform manual end-to-end verification via the Outlook UI dashboard

## 6. UI Fixes & Consolidating Audio (Feedback)
- [x] In pipeline.py: Concatenate all AudioSegments for each speaker into `speaker_{ID}_full.wav`
- [x] In index.html: Remove the entire Speaker-Specific Transcripts section from Main View
- [x] In index.html: Add placeholder Analytics and Settings panes
- [x] In app.js: Remove `renderTranscriptTurns` and navigation logic
- [x] In app.js: Add full-audio play button to speaker scorecards
- [x] Add new "Data" Nav Tab to display raw transcript words and individual sliced turn audio
