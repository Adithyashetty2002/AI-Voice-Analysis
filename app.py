import os
import sys
from dotenv import load_dotenv

os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

load_dotenv()

# Fix for Triton compilation missing Python.h
_include_dir = os.path.abspath('local-python-dev/usr/include')
_py_include_dir = os.path.join(_include_dir, 'python3.10')
os.environ["CPATH"] = f"{_include_dir}:{_py_include_dir}:" + os.environ.get("CPATH", "")

import json
import logging
import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, message=".*ffmpeg or avconv.*")
# Configure PyTorch memory allocator to avoid fragmentation OOMs before loading torch
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

import uuid
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
import shutil
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional
import hashlib
from fastapi import Depends
from sqlalchemy.orm import Session
from config import get_db, SessionLocal, COLOR_EXCELLENT, COLOR_GOOD, COLOR_NEEDS_IMPROVEMENT, COLOR_NA, SCORE_THRESHOLD_EXCELLENT, SCORE_THRESHOLD_GOOD, TARGET_BENCHMARK
import models
from s3_storage import s3_client
import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString

def dict_to_xml_str(data: Any, root_tag: str = "AnalysisReport") -> str:
    def sanitize_tag(key: str) -> str:
        import re
        tag = re.sub(r'[^a-zA-Z0-9_]', '_', str(key))
        tag = re.sub(r'_+', '_', tag).strip('_')
        if tag and tag[0].isdigit():
            tag = "_" + tag
        return tag or "item"

    def build_tree(element: ET.Element, value: Any):
        if isinstance(value, dict):
            for k, v in value.items():
                child = ET.SubElement(element, sanitize_tag(k))
                build_tree(child, v)
        elif isinstance(value, list):
            for item in value:
                child = ET.SubElement(element, "item")
                build_tree(child, item)
        else:
            element.text = str(value)

    root = ET.Element(root_tag)
    build_tree(root, data)
    
    xml_str = ET.tostring(root, encoding='unicode')
    dom = parseString(xml_str)
    return dom.toprettyxml(indent="  ")

# Import pipeline
from pipeline import VoiceAnalysisPipeline

def map_qa_keys(data):
    if not isinstance(data, dict):
        return data
    mapping = {
        "greeting_verification": "Greeting & Customer Verification",
        "active_listening_empathy": "Active Listening and Empathy",
        "probing_issue": "Probing the issue",
        "validating_priority": "Validating Priority of the issue",
        "accurate_troubleshooting": "Accurate troubleshooting of Issue",
        "solution_accuracy": "Accuracy of Solution Provided",
        "valid_escalation": "Valid Escalation",
        "knowledge_base_use": "Use of Knowledge Base",
        "critical_compliance": "Critical/P1 Compliance",
        "ticket_documentation": "Ticket Documentation & category selection",
        "time_entry_agreement": "Time entry & Agreement",
        "incident_ownership": "Ownership of Incident",
        "stakeholder_communication": "Communication to EU/Admin/stakeholders within timeline",
        "proper_closing_satisfaction": "Proper Closing & Confirmation of Satisfaction",
        "first_call_resolution": "First Call Resolution",
        "thirty_minute_rule": "30 minute rule",
        "minimal_transfers_holds": "Minimal Transfers/Hold Time",
        "communication_professionalism": "Communication & Professionalism",
        "technical_accuracy": "Technical Accuracy & Resolution",
        "process_adherence": "Process Adherence",
        "customer_experience": "Customer Experience",
        "efficiency_metrics": "Efficiency Metrics",
        "overall_score_percentage": "Overall Score Percentage",
        "technical_reviewer_feedback": "Technical Reviewer Feedback"
    }
    mapped = {}
    for k, v in data.items():
        new_k = mapping.get(k, k)
        if isinstance(v, dict):
            mapped[new_k] = map_qa_keys(v)
        else:
            mapped[new_k] = v
    return mapped

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"
)
logger = logging.getLogger("server")

# Define directories
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(WORKSPACE_DIR, "static")
AUDIO_OUTPUT_DIR = os.path.join(STATIC_DIR, "audio")
SESSIONS_DB_DIR = os.path.join(WORKSPACE_DIR, "data", "sessions")
AGENTS_DB_FILE = os.path.join(WORKSPACE_DIR, "data", "agents.json")

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(AUDIO_OUTPUT_DIR, exist_ok=True)
os.makedirs(SESSIONS_DB_DIR, exist_ok=True)
if not os.path.exists(AGENTS_DB_FILE):
    with open(AGENTS_DB_FILE, 'w') as f:
        json.dump([], f)

# Initialize FastAPI app
app = FastAPI(title="AI Voice Analysis Server", description="Outlook-Style AI Speaker Evaluation Dashboard")

# Enable CORS for local development UI access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory progress/task tracker
ACTIVE_TASKS: Dict[str, Dict[str, Any]] = {}

# Initialize voice analysis pipeline
pipeline = VoiceAnalysisPipeline()

def run_analysis_task(session_id: str, temp_audio_path: str, topic: str, agent_name: str = None, agent_id: str = None):
    """
    Background job executing the 5-stage sequential voice analysis pipeline.
    """
    logger.info(f"Starting background voice analysis for session: {session_id}")
    
    # Progress update callback
    def update_progress(message: str, percentage: int):
        ACTIVE_TASKS[session_id].update({
            "status": "processing",
            "progress_message": message,
            "progress_percent": percentage
        })
        logger.info(f"Session {session_id} Progress: {percentage}% - {message}")
        
    try:
        # Run pipeline
        result = pipeline.analyze_audio(
            session_id=session_id,
            raw_audio_path=temp_audio_path,
            topic=topic,
            output_base_dir=STATIC_DIR,  # Sliced clips saved inside static/audio/
            progress_callback=update_progress
        )
        
        if agent_name:
            result["agent_name"] = agent_name
        if agent_id:
            result["agent_id"] = agent_id
        
        # Save session to PostgreSQL
        with SessionLocal() as db:
            recording = db.query(models.Recording).filter(models.Recording.uuid == session_id).first()
            if recording:
                recording.pipeline_status = "success"
                recording.duration = result.get("metrics", {}).get("total_audio_duration_seconds")
                
                # Clean up existing records in case of a retry
                db.query(models.Transcript).filter(models.Transcript.recording_uuid == session_id).delete()
                db.query(models.Speaker).filter(models.Speaker.recording_uuid == session_id).delete()
                db.query(models.AnalysisResult).filter(models.AnalysisResult.recording_uuid == session_id).delete()
                
                # Insert Speakers
                for spk_label in list(set(t.get("speaker") for t in result.get("turns", []))):
                    speaker = models.Speaker(recording_uuid=session_id, speaker_label=spk_label, mapped_name="Unknown")
                    db.add(speaker)
                
                # Insert Transcripts
                for turn in result.get("turns", []):
                    transcript = models.Transcript(
                        recording_uuid=session_id,
                        speaker_label=turn.get("speaker", "UNKNOWN"),
                        start_time=turn.get("start", 0.0),
                        end_time=turn.get("end", 0.0),
                        text=turn.get("text", ""),
                        words=turn.get("words", [])
                    )
                    db.add(transcript)
                    
                # Insert Analysis Result
                eval_data = result.get("stage5_evaluation", {})
                
                # Update agent performance metrics for filtering
                transcript_eval = eval_data.get("transcript_evaluation", {})
                if transcript_eval.get("agent_name") and transcript_eval.get("agent_name") not in ["Unknown Agent", "[private_person]"]:
                    recording.agent_name = transcript_eval.get("agent_name")
                    recording.agent_id = recording.agent_name.lower().replace(" ", "_")

                analysis = models.AnalysisResult(
                    recording_uuid=session_id,
                    call_summary=eval_data.get("call_summary", ""),
                    sentiment_analysis=eval_data.get("sentiment_analysis", {}),
                    speaker_intents=eval_data.get("speaker_intents", {}),
                    qa_scorecard=eval_data.get("transcript_evaluation", {}),
                    action_items=eval_data.get("action_items", []),
                    raw_llm_output=result # Store the exact full dict for perfect backward compatibility
                )
                db.add(analysis)
                db.commit()
                
        # Also save as XML for LLM Output (Keeping this for legacy LLM compat if needed)
        xml_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.xml")
        llm_data = result.get("stage5_evaluation", {}).get("transcript_evaluation", {})
        llm_data = map_qa_keys(llm_data)
        os.makedirs(SESSIONS_DB_DIR, exist_ok=True)
        with open(xml_file, "w", encoding="utf-8") as f:
            f.write(dict_to_xml_str(llm_data, root_tag="LLM_Output"))
            
        ACTIVE_TASKS[session_id].update({
            "status": "success",
            "progress_message": "Analysis completed successfully.",
            "progress_percent": 100,
            "result": result
        })
        logger.info(f"Session {session_id} analysis completed successfully and saved.")
        
    except Exception as e:
        logger.error(f"Session {session_id} failed: {str(e)}")
        
        with SessionLocal() as db:
            recording = db.query(models.Recording).filter(models.Recording.uuid == session_id).first()
            if recording:
                recording.pipeline_status = "failed"
                recording.error_message = str(e)
                db.commit()
                
        ACTIVE_TASKS[session_id].update({
            "status": "failed",
            "progress_message": f"Analysis failed: {str(e)}",
            "progress_percent": 0,
            "error": str(e)
        })
    finally:
        # Cleanup temporary uploaded raw file
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)

def run_reevaluation_task(session_id: str, topic: str):
    """
    Background job executing ONLY the LLM re-evaluation stages (Stages 4 & 5).
    """
    logger.info(f"Starting background re-evaluation for session: {session_id}")
    
    def update_progress(message: str, percentage: int):
        ACTIVE_TASKS[session_id].update({
            "status": "processing",
            "progress_message": message,
            "progress_percent": percentage
        })
        logger.info(f"Session {session_id} Progress: {percentage}% - {message}")
        
    try:
        result = pipeline.reevaluate_session(
            session_id=session_id,
            topic=topic,
            output_base_dir=STATIC_DIR,
            progress_callback=update_progress
        )
        
        with next(get_db()) as db:
            recording = db.query(models.Recording).filter(models.Recording.uuid == session_id).first()
            if recording:
                stage5 = result.get("stage5_evaluation", {})
                eval_data = stage5.get("transcript_evaluation", {})
                
                if recording.analysis_result:
                    recording.analysis_result.qa_scorecard = eval_data
                    recording.analysis_result.raw_llm_output = result
                else:
                    recording.analysis_result = models.AnalysisResult(
                        recording_uuid=recording.uuid,
                        qa_scorecard=eval_data,
                        raw_llm_output=result
                    )
                
                # Update pipeline status
                recording.pipeline_status = "success"
                
                # Update agent performance metrics
                stage5 = result.get("stage5_evaluation", {})
                eval_data = stage5.get("transcript_evaluation", {})
                new_agent_name = eval_data.get("agent_name")
                if new_agent_name and new_agent_name not in ["Unknown Agent", "[private_person]"]:
                    recording.agent_name = new_agent_name
                
                # We can also update agent_id if agent_name changed
                if recording.agent_name and recording.agent_name not in ["Unknown Agent", "[private_person]"]:
                    recording.agent_id = recording.agent_name.lower().replace(" ", "_")
                
                recording.qa_score = float(eval_data.get("overall_score_percentage", 0))
                
                # Try to extract emotional summary
                emotions = stage5.get("speaker_emotions", {})
                agent_speaker = eval_data.get("agent_speaker_label", "SPEAKER_00")
                if agent_speaker and agent_speaker in emotions:
                    recording.primary_emotion = emotions[agent_speaker].get("emotion", "Neutral")
                    
                db.commit()
                
        xml_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.xml")
        llm_data = result.get("stage5_evaluation", {}).get("transcript_evaluation", {})
        llm_data = map_qa_keys(llm_data)
        with open(xml_file, "w", encoding="utf-8") as f:
            f.write(dict_to_xml_str(llm_data, root_tag="LLM_Output"))
            
        ACTIVE_TASKS[session_id].update({
            "status": "success",
            "progress_message": "Re-evaluation completed successfully.",
            "progress_percent": 100,
            "result": result
        })
        logger.info(f"Session {session_id} re-evaluation completed successfully and saved.")
        
    except Exception as e:
        logger.error(f"Session {session_id} re-evaluation failed: {str(e)}")
        ACTIVE_TASKS[session_id].update({
            "status": "failed",
            "progress_message": f"Re-evaluation failed: {str(e)}",
            "progress_percent": 0,
            "error": str(e)
        })


import zipfile
import csv
import io
import time

@app.post("/api/upload/bulk")
async def bulk_upload_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    agent_name: str = Form(None),
    agent_id: str = Form(None),
    db: Session = Depends(get_db)
):
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Must upload a .zip file.")
        
    temp_zip_path = os.path.join(WORKSPACE_DIR, "data", "temp", f"bulk_{uuid.uuid4()}.zip")
    os.makedirs(os.path.dirname(temp_zip_path), exist_ok=True)
    with open(temp_zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    extracted_sessions = []
    
    with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
        for filename in zip_ref.namelist():
            if filename.startswith("__MACOSX") or not filename.lower().endswith(('.wav', '.mp3', '.m4a', '.flac')):
                continue
                
            with zip_ref.open(filename) as source:
                file_bytes = source.read()
            
            file_hash = hashlib.md5(file_bytes).hexdigest()
            existing_audit = db.query(models.UploadAudit).filter(models.UploadAudit.md5_checksum == file_hash).first()
            if existing_audit:
                logger.warning(f"Skipping duplicate file in bulk upload: {filename}")
                continue
                
            session_id = str(uuid.uuid4())
            audio_path = os.path.join(WORKSPACE_DIR, "data", "temp", f"{session_id}_{os.path.basename(filename)}")
            
            with open(audio_path, "wb") as target:
                target.write(file_bytes)
                
            topic = os.path.basename(filename)
            
            s3_object_name = f"uploads/{session_id}_{os.path.basename(filename)}"
            s3_success = s3_client.upload_file(audio_path, s3_object_name)
            if not s3_success:
                logger.warning(f"Failed to upload {filename} to S3 in bulk upload.")
            
            audit = models.UploadAudit(
                md5_checksum=file_hash,
                original_file_name=os.path.basename(filename),
                uuid=session_id,
                s3_object_name=s3_object_name
            )
            db.add(audit)
            
            recording = models.Recording(
                uuid=session_id,
                title=topic,
                s3_key=s3_object_name,
                pipeline_status="pending",
                agent_id=agent_id,
                agent_name=agent_name
            )
            db.add(recording)
            db.commit()
            
            ACTIVE_TASKS[session_id] = {
                "status": "pending",
                "progress_message": "Queueing audio file analysis...",
                "progress_percent": 0
            }
            
            background_tasks.add_task(run_analysis_task, session_id, audio_path, topic, agent_name, agent_id)
            extracted_sessions.append(session_id)
            
    os.remove(temp_zip_path)
    return {"status": "success", "sessions_created": len(extracted_sessions)}

@app.post("/api/analyze/pending/{session_id}")
async def analyze_pending_endpoint(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    recording = db.query(models.Recording).filter(models.Recording.uuid == session_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    if recording.pipeline_status != "pending" and recording.pipeline_status != "failed":
        raise HTTPException(status_code=400, detail="Session is already processed or processing.")
        
    s3_key = recording.s3_key
    if not s3_key:
        raise HTTPException(status_code=400, detail="S3 Key missing for pending session.")
        
    # Download from S3 to temp folder if not already present locally
    temp_dir = os.path.join(WORKSPACE_DIR, "data", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    temp_audio_path = os.path.join(temp_dir, os.path.basename(s3_key))
    
    if not os.path.exists(temp_audio_path):
        success = s3_client.download_file(s3_key, temp_audio_path)
        if not success and not os.path.exists(temp_audio_path):
            normalized_path = os.path.join(WORKSPACE_DIR, "static", "audio", session_id, "normalized_input.wav")
            if os.path.exists(normalized_path):
                import shutil
                shutil.copy(normalized_path, temp_audio_path)
            else:
                raise HTTPException(status_code=404, detail="Failed to retrieve audio file from S3 and it was not found locally.")
        
    recording.pipeline_status = "pending"
    db.commit()
        
    ACTIVE_TASKS[session_id] = {
        "status": "pending",
        "progress_message": "Queueing audio file analysis...",
        "progress_percent": 0
    }
    
    background_tasks.add_task(run_analysis_task, session_id, temp_audio_path, recording.title or "", recording.agent_name, recording.agent_id)
    return {"session_id": session_id, "status": "processing"}

@app.post("/api/analyze")
async def analyze_audio_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    topic: str = Form(...),
    agent_name: str = Form(None),
    agent_id: str = Form(None),
    db: Session = Depends(get_db)
):
    """
    API endpoint for uploading audio files to start background scoring analysis.
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Invalid audio file.")
        
    session_id = str(uuid.uuid4())
    logger.info(f"Received audio analysis upload. Session: {session_id}, Topic: {topic}")
    
    # Save uploaded file to local temp path in chunks to support very large files
    temp_dir = os.path.join(WORKSPACE_DIR, "data", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    temp_audio_path = os.path.join(temp_dir, f"{session_id}_{file.filename}")
    
    md5_hash = hashlib.md5()
    with open(temp_audio_path, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):  # 1MB chunks
            md5_hash.update(chunk)
            buffer.write(chunk)
            
    file_hash = md5_hash.hexdigest()
    
    # Check deduplication
    existing_audit = db.query(models.UploadAudit).filter(models.UploadAudit.md5_checksum == file_hash).first()
    if existing_audit:
        os.remove(temp_audio_path) # Cleanup temp file for duplicate
        return JSONResponse(status_code=409, content={"status": "error", "message": "This file has already been uploaded."})
        
    # Upload to S3 asynchronously to avoid blocking the event loop
    import asyncio
    s3_object_name = f"uploads/{session_id}_{file.filename}"
    s3_success = await asyncio.to_thread(s3_client.upload_file, temp_audio_path, s3_object_name)
    if not s3_success:
        logger.warning(f"Failed to upload {file.filename} to S3, but continuing locally.")
        
    # Create DB records
    audit = models.UploadAudit(
        md5_checksum=file_hash,
        original_file_name=file.filename,
        uuid=session_id,
        s3_object_name=s3_object_name
    )
    db.add(audit)
    
    recording = models.Recording(
        uuid=session_id,
        title=topic,
        s3_key=s3_object_name,
        pipeline_status="pending",
        agent_id=agent_id,
        agent_name=agent_name
    )
    db.add(recording)
    db.commit()
    
    # Set initial task progress state
    ACTIVE_TASKS[session_id] = {
        "status": "pending",
        "progress_message": "Queueing audio file analysis...",
        "progress_percent": 0
    }
    
    # Queue background task
    background_tasks.add_task(run_analysis_task, session_id, temp_audio_path, topic, agent_name, agent_id)
    
    return {"session_id": session_id, "status": "processing"}

@app.post("/api/reevaluate/{session_id}")
async def reevaluate_session_endpoint(
    session_id: str,
    background_tasks: BackgroundTasks,
    topic: str = Form(...)
):
    """
    API endpoint to re-run only LLM evaluation on an existing session.
    """
    with next(get_db()) as db:
        recording = db.query(models.Recording).filter(models.Recording.uuid == session_id).first()
        if not recording:
            raise HTTPException(status_code=404, detail="Session report not found.")
        
    logger.info(f"Received re-evaluation request for session: {session_id}, Topic: {topic}")
    
    ACTIVE_TASKS[session_id] = {
        "status": "pending",
        "progress_message": "Queueing LLM re-evaluation...",
        "progress_percent": 0
    }
    
    background_tasks.add_task(run_reevaluation_task, session_id, topic)
    
    return {"session_id": session_id, "status": "processing"}

@app.get("/api/ui-config")
async def get_ui_config():
    """Returns UI configuration loaded from the .env file."""
    return {
        "colorExcellent": COLOR_EXCELLENT,
        "colorGood": COLOR_GOOD,
        "colorNeedsImprovement": COLOR_NEEDS_IMPROVEMENT,
        "colorNA": COLOR_NA,
        "scoreThresholdExcellent": SCORE_THRESHOLD_EXCELLENT,
        "scoreThresholdGood": SCORE_THRESHOLD_GOOD,
        "targetBenchmark": TARGET_BENCHMARK
    }

@app.get("/api/status/{session_id}")
async def get_analysis_status(session_id: str):
    """
    Polls the real-time progress / status of a specific running or finished task.
    """
    task = ACTIVE_TASKS.get(session_id)
    if task:
        return task
        
    # If not in active memory, check if it's already saved in disk database
    session_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.json")
    if os.path.exists(session_file):
        with open(session_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "status": "success",
            "progress_message": "Analysis loaded from database.",
            "progress_percent": 100,
            "result": data
        }
        
    raise HTTPException(status_code=404, detail="Analysis session task not found.")

@app.post("/api/agents/add")
async def add_agent(agent_name: str = Form(...), agent_id: str = Form(None), location: str = Form(None), department: str = Form(None)):
    final_id = agent_id.strip() if agent_id and agent_id.strip() else str(uuid.uuid4())
    agents = []
    if os.path.exists(AGENTS_DB_FILE):
        with open(AGENTS_DB_FILE, "r") as f:
            agents = json.load(f)

    if not any(a.get("agent_id") == final_id for a in agents):
        new_agent = {"agent_id": final_id, "agent_name": agent_name}
        if location: new_agent["location"] = location.strip()
        if department: new_agent["department"] = department.strip()
        agents.append(new_agent)
        with open(AGENTS_DB_FILE, "w") as f:
            json.dump(agents, f, indent=2)
        is_duplicate = False
    else:
        is_duplicate = True
            
    return {"status": "success", "agent_id": final_id, "agent_name": agent_name, "is_duplicate": is_duplicate}

@app.put("/api/agents/{agent_id}")
async def edit_agent(agent_id: str, agent_name: str = Form(...), new_agent_id: str = Form(None), location: str = Form(None), department: str = Form(None)):
    if not os.path.exists(AGENTS_DB_FILE):
        raise HTTPException(status_code=404, detail="Agents database not found.")
        
    with open(AGENTS_DB_FILE, "r") as f:
        agents = json.load(f)
        
    agent_found = False
    for a in agents:
        if a.get("agent_id") == agent_id:
            agent_found = True
            a["agent_name"] = agent_name
            if new_agent_id and new_agent_id.strip():
                a["agent_id"] = new_agent_id.strip()
            if location:
                a["location"] = location.strip()
            if department:
                a["department"] = department.strip()
            break
            
    if not agent_found:
        raise HTTPException(status_code=404, detail="Agent not found.")
        
    with open(AGENTS_DB_FILE, "w") as f:
        json.dump(agents, f, indent=2)
        
    return {"status": "success"}

@app.post("/api/agents/bulk")
async def bulk_add_agents(file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Must upload a .csv file.")
        
    content = await file.read()
    content_str = content.decode('utf-8')
    import csv, io
    reader = csv.DictReader(io.StringIO(content_str))
    
    agents = []
    if os.path.exists(AGENTS_DB_FILE):
        with open(AGENTS_DB_FILE, "r") as f:
            agents = json.load(f)
            
    added_count = 0
    rejected = []
    for row in reader:
        agent_name = row.get("agent_name")
        csv_id = row.get("agent_email") or row.get("agent_id")
        
        if not agent_name or not agent_name.strip():
            rejected.append({"agent_name": "", "agent_email": csv_id or "", "reason": "Missing agent_name"})
            continue
            
        final_id = csv_id.strip() if csv_id and csv_id.strip() else str(uuid.uuid4())
        
        if any(a.get("agent_id") == final_id for a in agents):
            rejected.append({"agent_name": agent_name.strip(), "agent_email": final_id, "reason": "Agent already exists"})
        else:
            new_agent = {"agent_id": final_id, "agent_name": agent_name.strip()}
            if row.get("location"): new_agent["location"] = row.get("location").strip()
            if row.get("department"): new_agent["department"] = row.get("department").strip()
            agents.append(new_agent)
            added_count += 1
                
    with open(AGENTS_DB_FILE, "w") as f:
        json.dump(agents, f, indent=2)
        
    return {"status": "success", "agents_added": added_count, "rejected": rejected}

@app.get("/api/agents/template")
async def download_agent_template():
    content = "agent_name,agent_email,location,department\n"
    from fastapi.responses import Response
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=agents_template.csv"}
    )

@app.delete("/api/agents/{agent_id}")
async def delete_agent(agent_id: str):
    agents_list = []
    if os.path.exists(AGENTS_DB_FILE):
        with open(AGENTS_DB_FILE, "r") as f:
            try:
                agents_list = json.load(f)
            except:
                pass
                
    found = False
    for a in agents_list:
        if a.get("agent_id") == agent_id:
            a["is_deleted"] = True
            found = True
            
    if not found:
        agents_list.append({
            "agent_id": agent_id,
            "agent_name": agent_id,
            "is_deleted": True
        })
        
    with open(AGENTS_DB_FILE, "w") as f:
        json.dump(agents_list, f, indent=4)
        
    return {"status": "deleted"}

@app.post("/api/agents/{agent_id}/restore")
async def restore_agent(agent_id: str):
    agents_list = []
    if os.path.exists(AGENTS_DB_FILE):
        with open(AGENTS_DB_FILE, "r") as f:
            try:
                agents_list = json.load(f)
            except:
                pass
                
    found = False
    for a in agents_list:
        if a.get("agent_id") == agent_id:
            a["is_deleted"] = False
            found = True
            
    if not found:
        agents_list.append({
            "agent_id": agent_id,
            "agent_name": agent_id,
            "is_deleted": False
        })
        
    with open(AGENTS_DB_FILE, "w") as f:
        json.dump(agents_list, f, indent=4)
        
    return {"status": "restored"}

@app.get("/api/agents")
async def list_agents(db: Session = Depends(get_db)):
    """
    Retrieves the list of configured agents and computes aggregate scoring statistics.
    """
    agents = {}
    if os.path.exists(AGENTS_DB_FILE):
        try:
            with open(AGENTS_DB_FILE, "r") as f:
                saved_agents = json.load(f)
                for a in saved_agents:

                    agents[a["agent_id"]] = {
                        "agent_id": a["agent_id"],
                        "agent_name": a["agent_name"],
                        "location": a.get("location", ""),
                        "department": a.get("department", ""),
                        "total_calls": 0,
                        "analyzed_calls": 0,
                        "sum_score": 0,
                        "emotion_counts": {},
                        "is_deleted": a.get("is_deleted", False)
                    }
        except:
            pass

    recordings = db.query(models.Recording).all()
    for recording in recordings:
        agent_name = recording.agent_name or "Unknown Agent"
        agent_id = recording.agent_id or agent_name
        
        is_analyzed = recording.pipeline_status == "success"
        score = 0
        emotion_str = "Neutral"
        
        if is_analyzed and recording.analysis_result and recording.analysis_result.raw_llm_output:
            data = recording.analysis_result.raw_llm_output
            stage5 = data.get("stage5_evaluation", {})
            transcript_eval = stage5.get("transcript_evaluation", {})
            
            emotions = stage5.get("speaker_emotions", {})
            agent_speaker = transcript_eval.get("agent_speaker_label", "")
            if agent_speaker and agent_speaker in emotions:
                emotion_str = emotions[agent_speaker].get("emotion", "Neutral")
                
            score = transcript_eval.get("overall_score_percentage", 0)
            
        # Merge logic: if agent_id not in agents, check if we have one with the same name
        matched_id = agent_id
        if agent_id not in agents:
            for existing_id, existing_stats in agents.items():
                if existing_stats["agent_name"].lower() == agent_name.lower():
                    matched_id = existing_id
                    break
                    
        if matched_id not in agents:
            agents[matched_id] = {
                "agent_id": matched_id,
                "agent_name": agent_name,
                "total_calls": 0,
                "analyzed_calls": 0,
                "sum_score": 0,
                "emotion_counts": {},
                "is_deleted": False
            }
            
        agents[matched_id]["total_calls"] += 1
        if is_analyzed:
            agents[matched_id]["analyzed_calls"] += 1
            agents[matched_id]["sum_score"] += score
            agents[matched_id]["emotion_counts"][emotion_str] = agents[matched_id]["emotion_counts"].get(emotion_str, 0) + 1
            
    return [
        {
            "agent_id": a["agent_id"],
            "agent_name": a["agent_name"],
            "department": a.get("department", ""),
            "location": a.get("location", ""),
            "total_calls": a["total_calls"],
            "analyzed_calls": a["analyzed_calls"],
            "avg_score": round(a["sum_score"] / a["analyzed_calls"], 1) if a["analyzed_calls"] > 0 else 0,
            "emotion_counts": a["emotion_counts"],
            "is_deleted": a.get("is_deleted", False)
        }
        for a in agents.values()
    ]

@app.get("/api/agents/{agent_id}/sessions")
async def list_agent_sessions(agent_id: str, days: int = 7, start_date: str | None = None, end_date: str | None = None, start_ts: float | None = None, end_ts: float | None = None, db: Session = Depends(get_db)):
    """
    Retrieves sessions for a specific agent filtered by days or date range.
    """
    import time
    from datetime import datetime, timezone
    cutoff_time = time.time() - (days * 24 * 3600)
    
    start_timestamp = start_ts
    end_timestamp = end_ts
    
    if start_date and end_date and not start_timestamp:
        try:
            start_timestamp = datetime.strptime(start_date, "%Y-%m-%d").timestamp()
            end_timestamp = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59).timestamp()
        except Exception:
            pass
            
    sessions = []
    try:
        target_name = agent_id
        if os.path.exists(AGENTS_DB_FILE):
            try:
                with open(AGENTS_DB_FILE, "r") as f:
                    for a in json.load(f):
                        if a.get("agent_id") == agent_id:
                            target_name = a.get("agent_name", agent_id)
                            break
            except:
                pass
                
        recordings = db.query(models.Recording).filter(
            (models.Recording.agent_id == agent_id) | 
            (models.Recording.agent_name == agent_id) |
            (models.Recording.agent_name.ilike(target_name))
        ).all()
        
        for recording in recordings:
            file_mtime = recording.created_at.timestamp() if recording.created_at else 0
            
            if start_timestamp and end_timestamp:
                if file_mtime < start_timestamp or file_mtime > end_timestamp:
                    continue
            elif file_mtime < cutoff_time:
                continue
                
            session_dict = {
                "session_id": recording.uuid,
                "topic": recording.title or "",
                "status": recording.pipeline_status,
                "created_at": file_mtime,
                "stage5_evaluation": {
                    "transcript_evaluation": {},
                    "speaker_emotions": {}
                }
            }
            
            analysis = recording.analysis_result
            if analysis and analysis.raw_llm_output:
                data = analysis.raw_llm_output
                stage5 = data.get("stage5_evaluation", {})
                session_dict["stage5_evaluation"]["transcript_evaluation"] = stage5.get("transcript_evaluation", {})
                session_dict["stage5_evaluation"]["speaker_emotions"] = stage5.get("speaker_emotions", {})
                
            sessions.append(session_dict)
    except Exception as e:
        logger.error(f"Error querying list_agent_sessions: {e}")
        
    # Sort sessions by timestamp descending (newest first)
    sessions.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    return sessions

@app.get("/api/sessions")
async def list_sessions(db: Session = Depends(get_db)):
    """
    Retrieves all past saved analysis sessions (for the Outlook sidebar list).
    """
    sessions = []
    try:
        recordings = db.query(models.Recording).order_by(models.Recording.created_at.desc()).all()
        for recording in recordings:
            session_dict = {
                "session_id": recording.uuid,
                "topic": recording.title or "",
                "status": recording.pipeline_status,
                "total_duration": recording.duration or 0.0,
                "speakers_count": 0,
                "overall_score": 0
            }
            
            analysis = recording.analysis_result
            if analysis and analysis.raw_llm_output:
                data = analysis.raw_llm_output
                session_dict["total_duration"] = data.get("metrics", {}).get("total_audio_duration_seconds", recording.duration or 0.0)
                session_dict["speakers_count"] = len(data.get("metrics", {}).get("speaker_statistics", {}))
                session_dict["overall_score"] = data.get("stage5_evaluation", {}).get("transcript_evaluation", {}).get("overall_score_percentage", 0)
                
            sessions.append(session_dict)
    except Exception as e:
        logger.error(f"Error querying list_sessions: {e}")
    return sessions

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, db: Session = Depends(get_db)):
    """
    Retrieves detailed scorecard JSON data of a specific saved session.
    """
    recording = db.query(models.Recording).filter(models.Recording.uuid == session_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Session report not found.")
        
    analysis = recording.analysis_result
    if analysis and analysis.raw_llm_output:
        return analysis.raw_llm_output
        
    # Synthesize JSON for pending/failed sessions
    return {
        "session_id": recording.uuid,
        "topic": recording.title or "",
        "status": recording.pipeline_status,
        "agent_name": recording.agent_name,
        "agent_id": recording.agent_id,
        "error": recording.error_message
    }

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, db: Session = Depends(get_db)):
    """
    Deletes a specific saved analysis session and its corresponding static speaker audio directories.
    """
    recording = db.query(models.Recording).filter(models.Recording.uuid == session_id).first()
    if recording:
        db.delete(recording)
        db.commit()
        
    # Delete corresponding audio chunks directory in static folder
    session_audio_dir = os.path.join(AUDIO_OUTPUT_DIR, session_id)
    if os.path.exists(session_audio_dir):
        shutil.rmtree(session_audio_dir)
        
    return {"status": "deleted"}

# Serve Frontend static UI folder
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def serve_index():
    """
    Serves the main Outlook UI webpage.
    """
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse(status_code=404, content={"message": "Outlook HTML interface not found. Please create static/index.html"})

@app.post("/api/send_email")
async def send_email(
    to_email: str = Form(...),
    subject: str = Form(...),
    body: str = Form(...),
    pdf_file: UploadFile = File(...)
):
    sender = os.getenv("GMAIL_SENDER")
    password = os.getenv("GMAIL_APP_PASSWORD")
    
    if not sender or not password:
        raise HTTPException(status_code=500, detail="Gmail credentials are not configured in the server .env file.")
        
    try:
        msg = MIMEMultipart()
        msg['From'] = sender
        msg['To'] = to_email
        msg['Subject'] = subject
        
        msg.attach(MIMEText(body, 'plain'))
        
        pdf_bytes = await pdf_file.read()
        part = MIMEApplication(pdf_bytes, Name=pdf_file.filename)
        part['Content-Disposition'] = f'attachment; filename="{pdf_file.filename}"'
        msg.attach(part)
        
        import asyncio
        def _send_sync():
            server = smtplib.SMTP('smtp.gmail.com', 587, timeout=15)
            server.starttls()
            server.login(sender, password)
            server.send_message(msg)
            server.quit()
            
        await asyncio.to_thread(_send_sync)

        
        return {"status": "success", "message": "Email sent successfully!"}
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Start web server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
