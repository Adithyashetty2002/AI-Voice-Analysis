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
import shutil
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any
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
        
        # Save session database file to disk
        session_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.json")
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            
        # Also save as XML for LLM Output
        xml_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.xml")
        llm_data = result.get("stage5_evaluation", {}).get("transcript_evaluation", {})
        llm_data = map_qa_keys(llm_data)
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
        
        session_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.json")
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            
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
    agent_id: str = Form(None)
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
                
            session_id = str(uuid.uuid4())
            audio_path = os.path.join(WORKSPACE_DIR, "data", "temp", f"{session_id}_{os.path.basename(filename)}")
            
            with zip_ref.open(filename) as source, open(audio_path, "wb") as target:
                shutil.copyfileobj(source, target)
                
            topic = os.path.basename(filename)
            
            session_data = {
                "session_id": session_id,
                "status": "pending",
                "agent_name": agent_name or "Unknown Agent",
                "agent_id": agent_id,
                "topic": topic,
                "created_at": time.time()
            }
            
            session_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.json")
            with open(session_file, "w", encoding="utf-8") as sf:
                json.dump(session_data, sf, indent=2, ensure_ascii=False)
                
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
    background_tasks: BackgroundTasks
):
    session_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.json")
    if not os.path.exists(session_file):
        raise HTTPException(status_code=404, detail="Session not found.")
        
    with open(session_file, "r") as f:
        data = json.load(f)
        
    if data.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Session is already processed or processing.")
        
    audio_path = data.get("audio_path")
    topic = data.get("topic")
    
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(status_code=400, detail="Audio file missing for pending session.")
        
    ACTIVE_TASKS[session_id] = {
        "status": "pending",
        "progress_message": "Queueing audio file analysis...",
        "progress_percent": 0
    }
    
    background_tasks.add_task(run_analysis_task, session_id, audio_path, topic)
    return {"session_id": session_id, "status": "processing"}

@app.post("/api/analyze")
async def analyze_audio_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    topic: str = Form(...),
    agent_name: str = Form(None),
    agent_id: str = Form(None)
):
    """
    API endpoint for uploading audio files to start background scoring analysis.
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Invalid audio file.")
        
    session_id = str(uuid.uuid4())
    logger.info(f"Received audio analysis upload. Session: {session_id}, Topic: {topic}")
    
    # Save uploaded file to local temp path
    temp_dir = os.path.join(WORKSPACE_DIR, "data", "temp")
    os.makedirs(temp_dir, exist_ok=True)
    temp_audio_path = os.path.join(temp_dir, f"{session_id}_{file.filename}")
    
    with open(temp_audio_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
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
    session_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.json")
    if not os.path.exists(session_file):
        raise HTTPException(status_code=404, detail="Session report not found.")
        
    logger.info(f"Received re-evaluation request for session: {session_id}, Topic: {topic}")
    
    ACTIVE_TASKS[session_id] = {
        "status": "pending",
        "progress_message": "Queueing LLM re-evaluation...",
        "progress_percent": 0
    }
    
    background_tasks.add_task(run_reevaluation_task, session_id, topic)
    
    return {"session_id": session_id, "status": "processing"}

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

@app.get("/api/agents")
async def list_agents():
    """
    Retrieves a list of aggregated agents and their overall metrics.
    """
    agents = {}

    # Load standalone agents from JSON
    if os.path.exists(AGENTS_DB_FILE):
        try:
            with open(AGENTS_DB_FILE, "r") as f:
                standalone = json.load(f)
                for sa in standalone:
                    name = sa.get("agent_name", "Unknown Agent")
                    aid = sa.get("agent_id") or name
                    agents[aid] = {
                        "agent_id": aid,
                        "agent_name": name,
                        "total_calls": 0,
                        "analyzed_calls": 0,
                        "sum_score": 0,
                        "emotion_counts": {},
                        "is_deleted": sa.get("is_deleted", False)
                    }
        except:
            pass

    if not os.path.exists(SESSIONS_DB_DIR):
        return list(agents.values())

    for filename in os.listdir(SESSIONS_DB_DIR):
        if filename.endswith(".json") and "_speaker_" not in filename and "_conversation" not in filename and "_diarization" not in filename:
            filepath = os.path.join(SESSIONS_DB_DIR, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                stage5 = data.get("stage5_evaluation", {})
                transcript_eval = stage5.get("transcript_evaluation", {})
                
                agent_name = data.get("agent_name") or transcript_eval.get("agent_name", "Unknown Agent")
                agent_id = data.get("agent_id") or agent_name

                # Check for emotions from Smallest AI
                emotions = stage5.get("speaker_emotions", {})
                agent_speaker = transcript_eval.get("agent_speaker_label", "")

                emotion_str = "Neutral"
                if agent_speaker and agent_speaker in emotions:
                    emotion_str = emotions[agent_speaker].get("emotion", "Neutral")
                    
                score = transcript_eval.get("overall_score_percentage", 0)
                is_analyzed = data.get("status") == "success"
                
                if agent_id not in agents:
                    agents[agent_id] = {
                        "agent_id": agent_id,
                        "agent_name": agent_name,
                        "total_calls": 0,
                        "analyzed_calls": 0,
                        "sum_score": 0,
                        "emotion_counts": {},
                        "is_deleted": False
                    }
                    
                agents[agent_id]["total_calls"] += 1
                if is_analyzed:
                    agents[agent_id]["analyzed_calls"] += 1
                    agents[agent_id]["sum_score"] += score
                    agents[agent_id]["emotion_counts"][emotion_str] = agents[agent_id]["emotion_counts"].get(emotion_str, 0) + 1
                
            except Exception as e:
                logger.error(f"Error loading session file {filename}: {str(e)}")
                
    result = []
    for id, stats in agents.items():
        result.append({
            "agent_id": stats["agent_id"],
            "agent_name": stats["agent_name"],
            "total_calls": stats["total_calls"],
            "analyzed_calls": stats["analyzed_calls"],
            "avg_score": round(stats["sum_score"] / stats["analyzed_calls"], 1) if stats["analyzed_calls"] > 0 else 0,
            "emotion_counts": stats["emotion_counts"],
            "is_deleted": stats.get("is_deleted", False)
        })
        
    return result

@app.get("/api/agents/{agent_id}/sessions")
async def list_agent_sessions(agent_id: str, days: int = 7, start_date: str | None = None, end_date: str | None = None, start_ts: float | None = None, end_ts: float | None = None):
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
            # assuming local time or utc. simple local conversion:
            start_timestamp = datetime.strptime(start_date, "%Y-%m-%d").timestamp()
            end_timestamp = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59).timestamp()
        except Exception:
            pass
    
    sessions = []
    
    if not os.path.exists(SESSIONS_DB_DIR):
        return sessions

    for filename in os.listdir(SESSIONS_DB_DIR):
        if filename.endswith(".json") and "_speaker_" not in filename and "_conversation" not in filename and "_diarization" not in filename:
            filepath = os.path.join(SESSIONS_DB_DIR, filename)
            
            # Date filter using file modification time
            file_mtime = os.path.getmtime(filepath)
            
            if start_timestamp and end_timestamp:
                if file_mtime < start_timestamp or file_mtime > end_timestamp:
                    continue
            elif file_mtime < cutoff_time:
                continue
                
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                stage5 = data.get("stage5_evaluation", {})
                transcript_eval = stage5.get("transcript_evaluation", {})
                file_agent_name = data.get("agent_name") or transcript_eval.get("agent_name", "Unknown Agent")
                file_agent_id = data.get("agent_id") or file_agent_name
                
                if file_agent_id == agent_id:
                    sessions.append({
                        "session_id": data.get("session_id", filename.replace(".json", "")),
                        "topic": data.get("topic", ""),
                        "status": data.get("status", "success"),
                        "created_at": file_mtime,
                        "stage5_evaluation": {
                            "transcript_evaluation": transcript_eval,
                            "speaker_emotions": stage5.get("speaker_emotions", {})
                        }
                    })
                    
            except Exception as e:
                logger.error(f"Error loading session file {filename}: {str(e)}")
                
    # Sort sessions by timestamp descending (newest first)
    sessions.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    return sessions

@app.get("/api/sessions")
async def list_sessions():
    """
    Retrieves all past saved analysis sessions (for the Outlook sidebar list).
    """
    sessions = []
    for filename in os.listdir(SESSIONS_DB_DIR):
        if filename.endswith(".json") and "_speaker_" not in filename and "_conversation" not in filename and "_diarization" not in filename:
            filepath = os.path.join(SESSIONS_DB_DIR, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                # Exclude large raw fields to keep listing index query fast
                sessions.append({
                    "session_id": data.get("session_id", filename.replace(".json", "")),
                    "topic": data.get("topic", ""),
                    "status": data.get("status", "success"),
                    "total_duration": data.get("metrics", {}).get("total_audio_duration_seconds", 0.0),
                    "speakers_count": len(data.get("metrics", {}).get("speaker_statistics", {})),
                    "overall_score": data.get("stage5_evaluation", {}).get("transcript_evaluation", {}).get("overall_score_percentage", 0)
                })
            except Exception as e:
                logger.error(f"Error loading session file {filename}: {str(e)}")
                
    return sessions

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    """
    Retrieves detailed scorecard JSON data of a specific saved session.
    """
    session_file = os.path.join(SESSIONS_DB_DIR, f"{session_id}.json")
    if os.path.exists(session_file):
        with open(session_file, "r", encoding="utf-8") as f:
            return json.load(f)
            
    raise HTTPException(status_code=404, detail="Session report not found.")

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """
    Deletes a specific saved analysis session and its corresponding static speaker audio directories.
    """
    # 1. Delete all session-related files in the database directory
    if os.path.exists(SESSIONS_DB_DIR):
        for filename in os.listdir(SESSIONS_DB_DIR):
            if filename.startswith(session_id):
                file_path = os.path.join(SESSIONS_DB_DIR, filename)
                try:
                    os.remove(file_path)
                except Exception as e:
                    logger.error(f"Failed to delete session file {file_path}: {e}")
        
    # 2. Delete corresponding audio chunks directory in static folder
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

if __name__ == "__main__":
    import uvicorn
    # Start web server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
