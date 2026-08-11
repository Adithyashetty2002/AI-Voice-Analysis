import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import logging

load_dotenv()
logger = logging.getLogger(__name__)

# --- MinIO (S3) Configuration ---
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "https://aiyoo.in:4443")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "livekit-bucket")
MINIO_REGION = os.getenv("MINIO_REGION", "us-east-1")

# --- UI Colors Configuration ---
COLOR_EXCELLENT = os.getenv("COLOR_EXCELLENT", "#107c41")
COLOR_GOOD = os.getenv("COLOR_GOOD", "#0078d4")
COLOR_NEEDS_IMPROVEMENT = os.getenv("COLOR_NEEDS_IMPROVEMENT", "#d13438")
COLOR_NA = os.getenv("COLOR_NA", "#ffb900")

# --- UI Score Thresholds ---
SCORE_THRESHOLD_EXCELLENT = float(os.getenv("SCORE_THRESHOLD_EXCELLENT", "90"))
SCORE_THRESHOLD_GOOD = float(os.getenv("SCORE_THRESHOLD_GOOD", "75"))
TARGET_BENCHMARK = float(os.getenv("TARGET_BENCHMARK", "85"))
# --- PostgreSQL Configuration ---
# You must set DATABASE_URL in your .env file, e.g., postgresql://user:password@localhost/dbname
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    logger.warning("DATABASE_URL is not set. Database connection will fail.")

# SQLAlchemy setup
try:
    engine = create_engine(DATABASE_URL) if DATABASE_URL else None
    if engine:
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    else:
        SessionLocal = None
except Exception as e:
    logger.error(f"Error creating database engine: {e}")
    engine = None
    SessionLocal = None

Base = declarative_base()

def get_db():
    if not SessionLocal:
        raise Exception("Database not configured. Please set DATABASE_URL in .env")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Auto-create tables if they don't exist
try:
    if engine:
        import models
        Base.metadata.create_all(bind=engine)
except Exception as e:
    logger.error(f"Failed to create database tables: {e}")
