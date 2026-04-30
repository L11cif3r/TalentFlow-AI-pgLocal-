import csv
import os
import json
import logging
import re
from typing import List, Optional
from datetime import datetime

import httpx
from google import genai
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from dotenv import load_dotenv

# Force Python to read the .env file before doing anything else
load_dotenv()
# --- Configuration & Logging ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("talent-radar")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/talentradar")
# Fallback for development environments without a live Postgres
if not DATABASE_URL or DATABASE_URL == "":
    DATABASE_URL = "sqlite:///./talentradar.db"

SERP_API_KEY = os.getenv("SERP_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
HIGH_SCORE_THRESHOLD = 75.0

if not GEMINI_API_KEY:
    logger.warning("GEMINI_API_KEY not found. AI features will fail.")

# --- Database Setup ---
Base = declarative_base()
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class JobModel(Base):
    __tablename__ = "jobs"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    skills = Column(Text) # JSON string
    experience = Column(String)
    xray_query = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    candidates = relationship("CandidateModel", back_populates="job", cascade="all, delete-orphan")

class CandidateModel(Base):
    __tablename__ = "candidates"
    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id"))
    title = Column(String)
    link = Column(String, nullable=False)
    snippet = Column(Text)
    score = Column(Float)
    alignment_analysis = Column(Text)
    is_link_invalid = Column(Boolean, default=False)
    search_path = Column(String)
    status = Column(String, default="new")
    created_at = Column(DateTime, default=datetime.utcnow)
    job = relationship("JobModel", back_populates="candidates")

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Talent Radar API")

# CORS for React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Schemas ---
class JDRequest(BaseModel):
    text: str

class JDResponse(BaseModel):
    id: int
    title: str
    skills: List[str]
    experience: str
    xrayQuery: str

class SearchRequest(BaseModel):
    job_id: int
    query: str

class CandidateBase(BaseModel):
    title: str
    link: str
    snippet: str

class CandidateAnalysis(BaseModel):
    index: int
    score: float
    alignmentAnalysis: str

class AnalysisRequest(BaseModel):
    candidates: List[CandidateBase]
    jd: dict

class CandidateSave(BaseModel):
    job_id: int
    title: str
    link: str
    snippet: str
    score: float
    alignmentAnalysis: str
    isLinkInvalid: bool = False
    searchPath: Optional[str] = None

# --- Gemini Helpers ---
def _ensure_gemini_client():
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY missing")
    return genai.Client(api_key=GEMINI_API_KEY)


def _extract_text_from_gemini_response(response):
    if hasattr(response, "text"):
        return str(response.text)
    if hasattr(response, "candidates") and response.candidates:
        candidate = response.candidates[0]
        content = getattr(candidate, "content", candidate)
    else:
        content = getattr(response, "content", str(response))
    if hasattr(content, "text"):
        content = content.text
    return str(content)


def parse_gemini_json_response(response):
    content = _extract_text_from_gemini_response(response)
    content = content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\s*```$", "", content, flags=re.IGNORECASE)
    content = content.strip()
    return json.loads(content)


def save_candidate_to_csv(candidate_data: dict, filename: str = "top_candidates.csv"):
    file_exists = os.path.isfile(filename)
    with open(filename, mode="a", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=list(candidate_data.keys()))
        if not file_exists:
            writer.writeheader()
        writer.writerow(candidate_data)


def save_candidate_record(
    db: Session,
    job_id: int,
    title: str,
    link: str,
    snippet: str,
    score: float,
    alignment_analysis: str,
    is_link_invalid: bool = False,
    search_path: Optional[str] = None,
):
    existing = db.query(CandidateModel).filter(CandidateModel.job_id == job_id, CandidateModel.link == link).first()
    if existing:
        existing.title = title
        existing.snippet = snippet
        existing.score = score
        existing.alignment_analysis = alignment_analysis
        existing.is_link_invalid = is_link_invalid
        existing.search_path = search_path
        db.commit()
        db.refresh(existing)
        return existing, False

    db_candidate = CandidateModel(
        job_id=job_id,
        title=title,
        link=link,
        snippet=snippet,
        score=score,
        alignment_analysis=alignment_analysis,
        is_link_invalid=is_link_invalid,
        search_path=search_path,
        status="new"
    )
    db.add(db_candidate)
    db.commit()
    db.refresh(db_candidate)
    return db_candidate, True

# --- Endpoints ---

@app.post("/api/parse-jd", response_model=JDResponse)
async def parse_jd(request: JDRequest, db: Session = Depends(get_db)):
    client = _ensure_gemini_client()
    prompt = (
        "You are a recruiter assistant that extracts structured job data from unstructured text. "
        "Always return valid JSON only.\n\n"
        f"Analyze this Job Description and extract structured data for a recruiter.\nJD: {request.text}\n\n"
        "Return ONLY JSON:\n"
        "{\n  \"title\": \"Clean Job Title\",\n  \"skills\": [\"skill1\", \"skill2\"],\n  \"experience\": \"e.g. 5+ years\",\n  \"xrayQuery\": \"site:linkedin.com/in 'title' 'skill1' 'skill2'\"\n}"
    )
    try:
        response = client.models.generate_content(model='gemini-3-flash-preview', contents=prompt)
        data = parse_gemini_json_response(response)

        db_job = JobModel(
            title=data.get("title"),
            description=request.text,
            skills=json.dumps(data.get("skills")),
            experience=data.get("experience"),
            xray_query=data.get("xrayQuery")
        )
        db.add(db_job)
        db.commit()
        db.refresh(db_job)

        return {**data, "id": db_job.id}
    except Exception as e:
        logger.error(f"Gemini Parse JD Error: {e}")
        raise HTTPException(status_code=500, detail="Parsing failed")

@app.post("/api/search")
async def search_candidates(request: SearchRequest):
    if not SERP_API_KEY:
        raise HTTPException(status_code=500, detail="SerpAPI Key missing")

    async with httpx.AsyncClient(timeout=30.0) as client:
        params = {
            "q": request.query,
            "engine": "bing",
            "api_key": SERP_API_KEY,
            "num": 20
        }
        
        try:
            response = await client.get("https://serpapi.com/search", params=params)
            data = response.json()
            
            results = data.get("organic_results", [])[:5]
            filtered = [
                {
                    "title": r.get("title"),
                    "link": r.get("link"),
                    "snippet": r.get("snippet")
                }
                for r in results if "linkedin.com/in/" in r.get("link", "")
            ]
            
            return {"organic_results": filtered}
        except Exception as e:
            logger.exception("Detailed search error:")
            raise HTTPException(status_code=500, detail="Search failed")

@app.post("/api/analyze-candidates")
async def analyze_candidates(request: AnalysisRequest, db: Session = Depends(get_db)):
    client = _ensure_gemini_client()
    candidate_list = [
        {"index": i, "title": c.title, "snippet": c.snippet, "link": c.link}
        for i, c in enumerate(request.candidates)
    ]
    job_id = request.jd.get("id")
    if not isinstance(job_id, int):
        raise HTTPException(status_code=400, detail="Job ID is required in JD payload for candidate analysis.")

    prompt = (
        "You are a professional technical recruiter. Evaluate candidates against the provided job description and output valid JSON only. "
        "Do not modify candidate URLs.\n\n"
        f"TASK: Analyze these candidates against the JD.\nJD: {json.dumps(request.jd)}\n\n"
        f"CANDIDATES: {json.dumps(candidate_list)}\n\n"
        "Return ONLY a JSON array of objects with keys: index, score, alignmentAnalysis. Score should be a numeric percentage."
    )

    try:
        response = client.models.generate_content(model='gemini-3-flash-preview', contents=prompt)
        analysis_results = parse_gemini_json_response(response)
        if not isinstance(analysis_results, list):
            raise ValueError("Analysis response must be a JSON array")

        for item in analysis_results:
            index = int(item.get("index", -1))
            score = float(item.get("score", 0))
            alignment_analysis = item.get("alignmentAnalysis", "")
            if index < 0 or index >= len(candidate_list):
                continue

            candidate = candidate_list[index]
            if score >= HIGH_SCORE_THRESHOLD:
                saved_candidate, created = save_candidate_record(
                    db=db,
                    job_id=job_id,
                    title=candidate.get("title", ""),
                    link=candidate.get("link", ""),
                    snippet=candidate.get("snippet", ""),
                    score=score,
                    alignment_analysis=alignment_analysis,
                    is_link_invalid=False,
                    search_path=None,
                )
                # if created:
                #     save_candidate_to_csv({
                #         "job_id": job_id,
                #         "id": saved_candidate.id,
                #         "title": saved_candidate.title,
                #         "link": saved_candidate.link,
                #         "snippet": saved_candidate.snippet,
                #         "score": saved_candidate.score,
                #         "alignmentAnalysis": saved_candidate.alignment_analysis,
                #         "searchPath": saved_candidate.search_path,
                #         "status": saved_candidate.status,
                #         "createdAt": saved_candidate.created_at.isoformat()
                #     })

        return analysis_results
    except Exception as e:
        logger.error(f"Gemini Analysis Error: {e}")
        raise HTTPException(status_code=500, detail="Analysis failed")

@app.get("/api/jobs")
async def get_jobs(db: Session = Depends(get_db)):
    jobs = db.query(JobModel).order_by(JobModel.created_at.desc()).all()
    return [{
        "id": j.id,
        "title": j.title,
        "skills": json.loads(j.skills) if j.skills else [],
        "experience": j.experience,
        "xrayQuery": j.xray_query,
        "jdText": j.description,
        "createdAt": j.created_at
    } for j in jobs]

@app.get("/api/jobs/{job_id}/candidates")
async def get_job_candidates(job_id: int, db: Session = Depends(get_db)):
    candidates = db.query(CandidateModel).filter(CandidateModel.job_id == job_id).all()
    return [{
        "id": c.id,
        "title": c.title,
        "link": c.link,
        "snippet": c.snippet,
        "score": c.score,
        "alignmentAnalysis": c.alignment_analysis,
        "isLinkInvalid": c.is_link_invalid,
        "searchPath": c.search_path,
        "status": c.status,
        "createdAt": c.created_at
    } for c in candidates]

@app.post("/api/candidates")
async def save_candidate(candidate: CandidateSave, db: Session = Depends(get_db)):
    db_candidate, _ = save_candidate_record(
        db=db,
        job_id=candidate.job_id,
        title=candidate.title,
        link=candidate.link,
        snippet=candidate.snippet,
        score=candidate.score,
        alignment_analysis=candidate.alignmentAnalysis,
        is_link_invalid=candidate.isLinkInvalid,
        search_path=candidate.searchPath,
    )
    return db_candidate

@app.patch("/api/candidates/{candidate_id}")
async def update_candidate(candidate_id: int, status_update: dict, db: Session = Depends(get_db)):
    db_candidate = db.query(CandidateModel).filter(CandidateModel.id == candidate_id).first()
    if not db_candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if "status" in status_update:
        db_candidate.status = status_update["status"]
    db.commit()
    return {"status": "updated"}

class OutreachRequest(BaseModel):
    candidate_snippet: str
    job_title: str
    skills: List[str]

@app.post("/api/generate-outreach")
async def generate_outreach(request: OutreachRequest):
    client = _ensure_gemini_client()
    prompt = (
        "You are a recruiting outreach assistant. Generate a personalized, professional email message for a potential candidate. "
        "Always return valid JSON only.\n\n"
        f"Generate a highly personalized, professional outreach message for a candidate.\nCandidate Bio: {request.candidate_snippet}\n"
        f"Target Role: {request.job_title}\nKey Skills Needed: {', '.join(request.skills)}\n\n"
        "Return ONLY JSON: { \"subject\": \"...\", \"body\": \"...\" }"
    )
    try:
        response = client.models.generate_content(model='gemini-3-flash-preview', contents=prompt)
        return parse_gemini_json_response(response)
    except Exception as e:
        logger.error(f"Gemini Outreach Error: {e}")
        raise HTTPException(status_code=500, detail="Generation failed")

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

# --- Frontend Serving ---
dist_path = Path("dist")

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow()}

# Static files should be mounted AFTER API routes
if dist_path.exists():
    app.mount("/", StaticFiles(directory="dist", html=True), name="static")

@app.get("/{full_path:path}")
async def catch_all(full_path: str):
    if dist_path.exists():
        index_file = dist_path / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
    return {"error": "Frontend not built or path not found"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
