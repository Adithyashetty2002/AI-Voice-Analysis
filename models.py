from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, Text, JSON, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from config import Base

class UploadAudit(Base):
    __tablename__ = "upload_audits"
    
    id = Column(Integer, primary_key=True, index=True)
    md5_checksum = Column(String, unique=True, index=True, nullable=False)
    original_file_name = Column(String, nullable=False)
    uuid = Column(String, unique=True, index=True, nullable=False)
    s3_object_name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Recording(Base):
    __tablename__ = "recordings"
    
    uuid = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=True)
    s3_key = Column(String, nullable=False)
    duration = Column(Float, nullable=True)
    pipeline_status = Column(String, default="pending")  # pending, processing, success, failed
    agent_id = Column(String, nullable=True)
    agent_name = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    transcripts = relationship("Transcript", back_populates="recording", cascade="all, delete-orphan")
    speakers = relationship("Speaker", back_populates="recording", cascade="all, delete-orphan")
    analysis_result = relationship("AnalysisResult", back_populates="recording", uselist=False, cascade="all, delete-orphan")

class Speaker(Base):
    __tablename__ = "speakers"
    
    id = Column(Integer, primary_key=True, index=True)
    recording_uuid = Column(String, ForeignKey("recordings.uuid"))
    speaker_label = Column(String, nullable=False)  # e.g., SPEAKER_00
    mapped_name = Column(String, nullable=True)     # e.g., Agent, Customer
    
    recording = relationship("Recording", back_populates="speakers")

class Transcript(Base):
    __tablename__ = "transcripts"
    
    id = Column(Integer, primary_key=True, index=True)
    recording_uuid = Column(String, ForeignKey("recordings.uuid"))
    speaker_label = Column(String, nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    text = Column(Text, nullable=False)
    confidence = Column(Float, nullable=True)
    words = Column(JSON, nullable=True) # Word-level timestamps
    
    recording = relationship("Recording", back_populates="transcripts")

class AnalysisResult(Base):
    __tablename__ = "analysis_results"
    
    id = Column(Integer, primary_key=True, index=True)
    recording_uuid = Column(String, ForeignKey("recordings.uuid"), unique=True)
    call_summary = Column(Text, nullable=True)
    sentiment_analysis = Column(JSON, nullable=True)
    speaker_intents = Column(JSON, nullable=True)
    qa_scorecard = Column(JSON, nullable=True)
    action_items = Column(JSON, nullable=True)
    raw_llm_output = Column(JSON, nullable=True) # Fallback to preserve the exact raw output
    
    recording = relationship("Recording", back_populates="analysis_result")
