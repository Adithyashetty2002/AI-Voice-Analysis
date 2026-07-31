# AI Voice Analysis & Speaker Scoring System (Pyannote & Whisper Large V3)

## Overview
This implementation plan covers the system architecture for the **AI Voice Analysis and Speaker Scoring System** in the [`Voice`](file:///home/adithya/Downloads/Antigravity%20IDE/Voice) workspace directory.

The system features a **Microsoft Outlook-style Web UI Dashboard** (Fluent Design aesthetics) where users can upload audio recordings via a "New Analysis" action, view past recordings in an inbox-style sidebar, and review rich AI Speaker Scorecards.

To optimize latency, cost, and scoring accuracy, **no audio files are ever sent to the LLM**. The LLM receives strictly text transcripts and duration metrics, while the extracted speaker audio clips are used exclusively by the browser's Outlook Web UI for interactive playback.

---

## System Architecture: Outlook UI + 4-Stage Intersectional Mapping Pipeline

```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                       OUTLOOK-STYLE WEB DASHBOARD                           │
 │  ┌──────────────────────┐  ┌─────────────────────────────────────────────┐  │
 │  │  + New Audio Upload  │  │  AI SPEAKER SCORECARD & PLAYBACK UI         │  │
 │  ├──────────────────────┤  ├─────────────────────────────────────────────┤  │
 │  │ 📥 Inbox / Sessions  │  │ • Speaker Performance Scorecards            │  │
 │  │ • Sales Pitch #1     │  │ • Topic Adherence & Fluency Ratings (0-100) │  │
 │  │ • Meeting Recording  │  │ • Clean Speaker Transcripts with Play Buttons│  │
 │  └──────────────────────┘  └─────────────────────────────────────────────┘  │
 └─────────────┬───────────────────────────────────────────────────────────────┘
               │ (1) File Upload / API Request
               ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ [FFmpeg Pre-processing]                                                     │
 │ • Converts raw audio to standardized format: Mono WAV, 16kHz,               │
 │   Loudness Normalized                                                       │
 └─────────────┬───────────────────────────────────────────────────────────────┘
               │ Standardized Mono WAV File
               ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ STAGE 1: Speaker Diarization First ("Who Spoke When")                       │
 │ • Pyannote speaker-diarization-3.1 pipeline                                 │
 │ • Outputs speaker intervals: [start_time, end_time, SPEAKER_ID]             │
 └─────────────┬───────────────────────────────────────────────────────────────┘
               │ Speaker Intervals Timeline
               ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ STAGE 2: Uncut Master Transcription (Whisper Large V3)                      │
 │ • Transcribes the ENTIRE uncut mono audio file using transformers pipeline  │
 │ • Generates a master list of all words with precise [start, end] timestamps │
 └─────────────┬───────────────────────────────────────────────────────────────┘
               │ Master Word Timestamps
               ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ STAGE 3: Intersectional Timeline Mapping & Formatting                       │
 │ • Mathematically maps Whisper's words onto Pyannote's speaker timeline.     │
 │ • Saves strictly independent, unmerged audio slices per turn                  │
 │ • Formats JSON strictly by individual turns without sentence concatenation    │
 └─────────────┬───────────────────────────────┬───────────────┘
               │ (A) Text & Durations          │ (B) Audio URLs
               ▼                               │     (Sent only to Web UI)
 ┌──────────────────────────────────────────┐  │
 │ STAGE 4: LLM AI Speaker Scoring Engine   │  │
 │ • Receives ONLY text and duration metrics│  │
 │ • Generates scores & feedback            │  │
 └─────────────────────┬────────────────────┘  │
                       │ (C) Scores & Analysis│
                       ▼                       ▼
 ┌─────────────────────────────────────────────────────────────┐
 │               App.py JSON Response Payload                  │
 │   (Combines Transcript Text + Voice URLs + LLM Scorecard)   │
 └─────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
                    [ Outlook UI Rendering ]
```

---

## Detailed Data Routing Flow

### Sliced Audio File Routing
- Independent turn audio clips (e.g., `/static/audio/..._speaker_01_turn_1.wav`) are saved in the static resources directory of the FastAPI backend.
- They are sent **only to the Web Dashboard UI** for user playback.
- **Never sent to the LLM.**

### Transcript Text & JSON Routing
- The word-level timestamps are mapped precisely to the speaker turns. Data is kept strictly isolated per turn.
- The exported JSON format exports an array of unmerged, independent turns for each speaker.
- A simplified, clean text transcript is passed to the **LLM (gpt-4o-mini)** to generate the scorecards.

---

## Stage-by-Stage Technical Specifications

### Pre-processing: FFmpeg Standardization
- **Process**: Downmixes stereo/multichannel to mono, resamples to 16,000Hz, and applies standard `loudnorm` loudness normalization.

### Stage 1: Speaker Diarization (Pyannote)
- **Model**: `pyannote/speaker-diarization-3.1` 
- **Execution**: Configured with reduced batch sizes to operate under VRAM constraints. Identifies unique speaker labels (`SPEAKER_00`, `SPEAKER_01`, etc.) and returns precise start and end segments.

### Stage 2: Master Transcription (Whisper Large V3)
- **Model**: `openai/whisper-large-v3` running via HuggingFace `pipeline`.
- **Execution**: Transcribes the entire standardized mono WAV in 30-second chunks using `return_timestamps="word"` with `batch_size=1` and `expandable_segments:True` PyTorch optimizations to prevent VRAM OOM.
- **Output**: Returns a master array of exact word-level timings without guessing the speaker.

### Stage 3: Timeline Mapping & Formatting
- **Mapping Algorithm**: Takes each word from Stage 2 and mathematically calculates its midpoint. If the midpoint falls within a Pyannote segment from Stage 1, that word is assigned to that Pyannote speaker.
- **Turn Isolation**: Eliminates cross-turn mixing by avoiding any sentence concatenation. Each speaker turn is preserved as an independent data structure.
- **Audio Extraction**: Slices the corresponding Pyannote time windows from the master audio file and exports them as independent, unmerged `.wav` files.

### Stage 4: LLM AI Speaker Scoring Engine
- **Inputs**: Receives strictly transcript text and turn durations.
- **Outputs**: Topic Adherence (0–100), Fluency, Floor Share %, and Content Quality scorecards via `gpt-4o-mini`.

---

## File Architecture in [`Voice`](file:///home/adithya/Downloads/Antigravity%20IDE/Voice)

#### [requirements.txt](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/requirements.txt)
Dependencies: `pyannote.audio`, `transformers`, `accelerate`, `torch`, `torchaudio`, `fastapi`, `uvicorn`, `pydantic`, `python-dotenv`, `jinja2`, `python-multipart`, `pydub`, `ffmpeg-python`.

#### [stage1_diarization.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/stage1_diarization.py)
Stage 1 `pyannote` speaker diarization pipeline with VRAM optimization and torchaudio monkey-patching.

#### [stage2_timestamping.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/stage2_timestamping.py)
Stage 2 uncut master transcription generation using `openai/whisper-large-v3`.

#### [pipeline.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/pipeline.py)
Main 4-stage sequential orchestrator handling model swapping, PyTorch VRAM optimization, mathematical intersectional mapping of words, and isolated turn-by-turn exports.

#### [app.py](file:///home/adithya/Downloads/Antigravity%20IDE/Voice/app.py)
FastAPI backend exposing endpoints for the Microsoft Outlook-style Web UI.
