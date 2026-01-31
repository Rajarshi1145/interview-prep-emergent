from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import json
import base64
import re
from PyPDF2 import PdfReader
import io
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from serpapi import GoogleSearch

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# API Keys
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
SERPAPI_KEY = os.environ.get('SERPAPI_KEY', '')

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============== MODELS ==============

class InterviewQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    answer: str
    category: str
    job_description: str
    source: Optional[str] = None
    source_url: Optional[str] = None
    company: Optional[str] = None
    skill_tag: Optional[str] = None  # e.g., "JavaScript", "Angular", "System Design"
    difficulty: Optional[str] = None  # "easy", "medium", "hard"
    created_at: datetime = Field(default_factory=datetime.utcnow)

class GenerateQuestionsRequest(BaseModel):
    job_description: str

class LoadMoreRequest(BaseModel):
    job_description: str
    category: str  # "technical", "behavioral", "situational", "company_specific"
    existing_questions: List[str] = []  # Already shown questions to avoid duplicates
    skills: List[str] = []  # Skills to focus on

class JobAnalysis(BaseModel):
    company_name: Optional[str] = None
    job_title: str
    industry: str
    seniority_level: str
    key_skills: List[str]
    technical_skills: List[str]  # Programming languages, frameworks, tools
    soft_skills: List[str]  # Communication, teamwork, etc.
    job_type: str
    domain: str  # "software", "mechanical", "data", "design", etc.

class GenerateQuestionsResponse(BaseModel):
    technical: List[InterviewQuestion]
    behavioral: List[InterviewQuestion]
    situational: List[InterviewQuestion]
    company_specific: List[InterviewQuestion]  # Real questions from company
    job_analysis: Optional[JobAnalysis] = None

class FavoriteQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    answer: str
    category: str
    job_description: str
    source: Optional[str] = None
    source_url: Optional[str] = None
    company: Optional[str] = None
    skill_tag: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class AddFavoriteRequest(BaseModel):
    question: str
    answer: str
    category: str
    job_description: str
    source: Optional[str] = None
    source_url: Optional[str] = None
    company: Optional[str] = None
    skill_tag: Optional[str] = None

class ExtractTextResponse(BaseModel):
    extracted_text: str
    source_type: str


# ============== SERPAPI FUNCTIONS ==============

def search_with_serpapi(query: str, num_results: int = 10) -> List[dict]:
    """Search Google using SerpAPI."""
    try:
        if not SERPAPI_KEY:
            logger.warning("SERPAPI_KEY not set")
            return []
            
        search = GoogleSearch({
            "q": query,
            "api_key": SERPAPI_KEY,
            "num": num_results
        })
        results = search.get_dict()
        return results.get("organic_results", [])
    except Exception as e:
        logger.error(f"SerpAPI error: {e}")
        return []


async def search_technical_questions_for_skills(skills: List[str], seniority: str) -> List[dict]:
    """
    Search for REAL technical interview questions for each skill.
    e.g., "JavaScript interview questions", "Angular interview questions senior"
    """
    all_questions = []
    
    for skill in skills[:5]:  # Limit to top 5 skills
        # Search for skill-specific technical questions
        queries = [
            f"{skill} interview questions {seniority}",
            f"{skill} coding interview questions",
            f"{skill} technical interview questions with answers",
        ]
        
        for query in queries[:2]:  # 2 queries per skill
            results = search_with_serpapi(query, num_results=5)
            
            for result in results:
                snippet = result.get("snippet", "")
                title = result.get("title", "")
                source = result.get("displayed_link", "").split("/")[0] if result.get("displayed_link") else "Web"
                
                if snippet:
                    all_questions.append({
                        "skill": skill,
                        "title": title,
                        "snippet": snippet,
                        "source": source,
                        "url": result.get("link", "")
                    })
    
    return all_questions


async def search_company_interview_questions(company: str, role: str) -> List[dict]:
    """Search for real interview questions from a specific company."""
    results = []
    
    queries = [
        f"{company} {role} interview questions Glassdoor",
        f"{company} interview experience {role}",
        f"what questions does {company} ask {role} interview",
    ]
    
    for query in queries:
        search_results = search_with_serpapi(query, num_results=5)
        for r in search_results:
            if r.get("snippet"):
                results.append({
                    "title": r.get("title", ""),
                    "snippet": r.get("snippet", ""),
                    "source": r.get("displayed_link", "").split("/")[0] if r.get("displayed_link") else "Web",
                    "url": r.get("link", "")
                })
    
    return results


# ============== AI FUNCTIONS ==============

async def analyze_job_description(job_description: str) -> dict:
    """Deeply analyze job description to extract ALL relevant info."""
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"analyze-{uuid.uuid4()}",
            system_message="You are an expert recruiter and technical interviewer."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Analyze this job description thoroughly and extract ALL technical details.

Job Description:
{job_description}

Return ONLY valid JSON (no markdown):
{{
    "company_name": "Company name or null",
    "job_title": "Exact job title",
    "industry": "tech/finance/healthcare/manufacturing/etc",
    "seniority_level": "intern/junior/mid/senior/lead/principal",
    "domain": "software/mechanical/electrical/data/design/marketing/etc",
    "technical_skills": ["List ALL technical skills: programming languages, frameworks, tools, technologies mentioned or implied"],
    "soft_skills": ["Communication", "teamwork", "leadership", etc],
    "key_skills": ["Top 5 most important skills for this role"],
    "job_type": "frontend/backend/fullstack/devops/data/ml/mechanical/electrical/etc"
}}

Be EXHAUSTIVE with technical_skills - include:
- Programming languages (JavaScript, Python, Java, C++, etc.)
- Frameworks (React, Angular, Vue, Django, Spring, etc.)
- Databases (SQL, MongoDB, PostgreSQL, etc.)
- Cloud (AWS, GCP, Azure)
- Tools (Git, Docker, Kubernetes, etc.)
- Domain-specific tech (CAD, MATLAB, etc. for engineering)
- Any technology mentioned or strongly implied"""

        response = await chat.send_message(UserMessage(text=prompt))
        
        content = response.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if "```" in content:
                content = content.rsplit("```", 1)[0]
        
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        
        return json.loads(content, strict=False)
        
    except Exception as e:
        logger.error(f"Job analysis error: {e}")
        return {
            "company_name": None,
            "job_title": "Software Engineer",
            "industry": "technology",
            "seniority_level": "mid",
            "domain": "software",
            "technical_skills": [],
            "soft_skills": [],
            "key_skills": [],
            "job_type": "engineering"
        }


async def extract_questions_from_search_results(search_results: List[dict], skill: str = None) -> List[dict]:
    """Extract actual interview questions from search result snippets."""
    if not search_results:
        return []
    
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"extract-{uuid.uuid4()}",
            system_message="You extract interview questions from text snippets."
        ).with_model("gemini", "gemini-2.5-flash")
        
        snippets_text = "\n\n".join([
            f"Source: {r.get('source', 'Unknown')}\nTitle: {r.get('title', '')}\nContent: {r.get('snippet', '')}"
            for r in search_results[:15]
        ])
        
        skill_context = f" for {skill}" if skill else ""
        
        prompt = f"""From these search results about interview questions{skill_context}, extract ACTUAL questions mentioned.

Search Results:
{snippets_text}

Extract real questions from the snippets. Return ONLY valid JSON array:
[
  {{
    "question": "The actual question",
    "answer": "A good answer approach (2-3 sentences)",
    "source": "Source website",
    "difficulty": "easy/medium/hard"
  }}
]

Rules:
- Only extract questions ACTUALLY mentioned or clearly implied in snippets
- Include technical questions, coding questions, and conceptual questions
- Provide helpful but concise answers
- Max 8 questions"""

        response = await chat.send_message(UserMessage(text=prompt))
        
        content = response.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if "```" in content:
                content = content.rsplit("```", 1)[0]
        
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        
        return json.loads(content, strict=False)
    except Exception as e:
        logger.error(f"Question extraction error: {e}")
        return []


async def generate_deep_technical_questions(
    skills: List[str],
    seniority: str,
    domain: str,
    sample_questions: List[dict] = None,
    count: int = 8
) -> List[dict]:
    """
    Generate DEEP technical questions based on real examples.
    These should be actual coding/technical questions, not behavioral.
    """
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"technical-{uuid.uuid4()}",
            system_message="You are a senior technical interviewer who asks challenging, specific technical questions."
        ).with_model("gemini", "gemini-2.5-flash")
        
        # Build context from sample questions
        sample_context = ""
        if sample_questions:
            sample_context = f"""
Here are REAL technical questions from interviews that set the expected depth:
{json.dumps(sample_questions[:5], indent=2)}

Generate questions at THIS level of technical depth or deeper.
"""
        
        skills_str = ", ".join(skills[:8])
        
        prompt = f"""Generate {count} DEEP technical interview questions for a {seniority} {domain} role.

Required skills: {skills_str}
{sample_context}

CRITICAL RULES:
1. Questions must be ACTUALLY TECHNICAL - ask about code, algorithms, system design, architecture
2. DO NOT ask behavioral questions disguised as technical
3. DO NOT reference "the job description" in questions
4. Questions should test REAL knowledge that a {domain} professional would need
5. Include a mix of:
   - Coding/implementation questions ("Write a function that...", "How would you implement...")
   - Conceptual questions ("Explain the difference between...", "What happens when...")
   - Problem-solving ("Given a system that...", "How would you optimize...")
   - Debugging ("What's wrong with this code...", "How would you debug...")

For SOFTWARE roles, ask about:
- Specific language features (closures, promises, generics, etc.)
- Framework internals (React hooks lifecycle, Angular change detection, etc.)
- Algorithms and data structures
- System design and architecture
- Database queries and optimization
- API design

For OTHER ENGINEERING roles (mechanical, electrical, etc.), ask about:
- Domain-specific calculations
- Design principles
- Tools and software
- Standards and regulations
- Troubleshooting scenarios

Return ONLY valid JSON array:
[
  {{
    "question": "Specific technical question",
    "answer": "Detailed technical answer with code examples if applicable",
    "skill_tag": "Primary skill being tested",
    "difficulty": "easy/medium/hard"
  }}
]"""

        response = await chat.send_message(UserMessage(text=prompt))
        
        content = response.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if "```" in content:
                content = content.rsplit("```", 1)[0]
        
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        
        return json.loads(content, strict=False)
    except Exception as e:
        logger.error(f"Technical question generation error: {e}")
        return []


async def generate_behavioral_questions(job_title: str, seniority: str, count: int = 6) -> List[dict]:
    """Generate behavioral interview questions."""
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"behavioral-{uuid.uuid4()}",
            system_message="You are an HR interviewer."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Generate {count} behavioral interview questions for a {seniority} {job_title}.

Use STAR method format. Focus on:
- Past experiences and achievements
- Conflict resolution
- Leadership and teamwork
- Problem-solving approach
- Career goals and motivation

Return ONLY valid JSON array:
[
  {{
    "question": "Tell me about a time when...",
    "answer": "Structure your answer using STAR: Situation, Task, Action, Result. Example approach...",
    "difficulty": "easy/medium/hard"
  }}
]"""

        response = await chat.send_message(UserMessage(text=prompt))
        
        content = response.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if "```" in content:
                content = content.rsplit("```", 1)[0]
        
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        
        return json.loads(content, strict=False)
    except Exception as e:
        logger.error(f"Behavioral generation error: {e}")
        return []


async def generate_situational_questions(job_title: str, domain: str, count: int = 6) -> List[dict]:
    """Generate situational interview questions."""
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"situational-{uuid.uuid4()}",
            system_message="You are a hiring manager."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Generate {count} situational interview questions for a {job_title} in {domain}.

These should be hypothetical scenarios:
- "What would you do if..."
- "How would you handle..."
- "Imagine you're faced with..."

Make scenarios REALISTIC and SPECIFIC to the role.

Return ONLY valid JSON array:
[
  {{
    "question": "What would you do if...",
    "answer": "A good approach would be to...",
    "difficulty": "easy/medium/hard"
  }}
]"""

        response = await chat.send_message(UserMessage(text=prompt))
        
        content = response.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if "```" in content:
                content = content.rsplit("```", 1)[0]
        
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        
        return json.loads(content, strict=False)
    except Exception as e:
        logger.error(f"Situational generation error: {e}")
        return []


# ============== FILE EXTRACTION ==============

async def extract_text_from_image(image_base64: str) -> str:
    """Extract text from image using Gemini Vision."""
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"ocr-{uuid.uuid4()}",
            system_message="You extract text from images accurately."
        ).with_model("gemini", "gemini-2.5-flash")
        
        message = UserMessage(
            text="Extract ALL text from this job posting image. Preserve structure.",
            file_contents=[ImageContent(image_base64=image_base64)]
        )
        
        return (await chat.send_message(message)).strip()
    except Exception as e:
        logger.error(f"OCR error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def extract_text_from_pdf(pdf_content: bytes) -> str:
    """Extract text from PDF."""
    try:
        reader = PdfReader(io.BytesIO(pdf_content))
        return "\n".join(page.extract_text() for page in reader.pages).strip()
    except Exception as e:
        logger.error(f"PDF error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============== API ROUTES ==============

@api_router.get("/")
async def root():
    return {"message": "Interview Prep API v3 - Deep Technical Questions"}


@api_router.post("/extract-text", response_model=ExtractTextResponse)
async def extract_text(file: UploadFile = File(...)):
    """Extract text from PDF or image."""
    content = await file.read()
    filename = file.filename.lower() if file.filename else ""
    
    if filename.endswith('.pdf'):
        return ExtractTextResponse(extracted_text=extract_text_from_pdf(content), source_type="pdf")
    elif any(filename.endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.webp']):
        image_base64 = base64.b64encode(content).decode('utf-8')
        return ExtractTextResponse(extracted_text=await extract_text_from_image(image_base64), source_type="image")
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type")


@api_router.post("/extract-text-base64")
async def extract_text_base64(image_base64: str = Form(...)):
    """Extract text from base64 image."""
    if ',' in image_base64:
        image_base64 = image_base64.split(',')[1]
    return {"extracted_text": await extract_text_from_image(image_base64), "source_type": "image"}


@api_router.post("/generate-questions", response_model=GenerateQuestionsResponse)
async def generate_questions(request: GenerateQuestionsRequest):
    """Generate comprehensive interview questions with real web sources."""
    
    try:
        # Step 1: Deep analysis of job description
        job_analysis = await analyze_job_description(request.job_description)
        logger.info(f"Job Analysis: {job_analysis}")
        
        company = job_analysis.get("company_name")
        job_title = job_analysis.get("job_title", "Engineer")
        seniority = job_analysis.get("seniority_level", "mid")
        domain = job_analysis.get("domain", "software")
        technical_skills = job_analysis.get("technical_skills", [])
        
        # Step 2: Search for REAL technical questions for each skill
        logger.info(f"Searching technical questions for skills: {technical_skills}")
        skill_search_results = await search_technical_questions_for_skills(technical_skills, seniority)
        
        # Step 3: Extract real questions from search results
        real_technical_questions = []
        if skill_search_results:
            real_technical_questions = await extract_questions_from_search_results(
                skill_search_results, 
                skill=", ".join(technical_skills[:3])
            )
            logger.info(f"Extracted {len(real_technical_questions)} real technical questions")
        
        # Step 4: Generate DEEP technical questions based on real examples
        ai_technical_questions = await generate_deep_technical_questions(
            skills=technical_skills,
            seniority=seniority,
            domain=domain,
            sample_questions=real_technical_questions,
            count=10
        )
        
        # Step 5: Search for company-specific questions if company is known
        company_questions = []
        if company:
            logger.info(f"Searching company questions for {company}")
            company_search = await search_company_interview_questions(company, job_title)
            company_questions = await extract_questions_from_search_results(company_search)
        
        # Step 6: Generate behavioral and situational questions
        behavioral = await generate_behavioral_questions(job_title, seniority, count=6)
        situational = await generate_situational_questions(job_title, domain, count=6)
        
        # Build response
        def to_interview_question(q: dict, category: str, source: str = "ai_generated") -> InterviewQuestion:
            return InterviewQuestion(
                question=q.get("question", ""),
                answer=q.get("answer", ""),
                category=category,
                job_description=request.job_description,
                source=source,
                source_url=q.get("source"),
                company=company,
                skill_tag=q.get("skill_tag"),
                difficulty=q.get("difficulty", "medium")
            )
        
        # Combine real + AI technical questions
        all_technical = []
        for q in real_technical_questions:
            all_technical.append(to_interview_question(q, "technical", "web_search"))
        for q in ai_technical_questions:
            all_technical.append(to_interview_question(q, "technical", "ai_generated"))
        
        return GenerateQuestionsResponse(
            technical=all_technical,
            behavioral=[to_interview_question(q, "behavioral") for q in behavioral],
            situational=[to_interview_question(q, "situational") for q in situational],
            company_specific=[to_interview_question(q, "company_specific", "web_search") for q in company_questions],
            job_analysis=JobAnalysis(**job_analysis) if job_analysis else None
        )
        
    except Exception as e:
        logger.error(f"Generate questions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/load-more")
async def load_more_questions(request: LoadMoreRequest):
    """Load more questions of a specific category."""
    
    try:
        existing = set(request.existing_questions)
        
        if request.category == "technical":
            # Generate more technical questions
            questions = await generate_deep_technical_questions(
                skills=request.skills,
                seniority="mid",
                domain="software",
                count=6
            )
        elif request.category == "behavioral":
            questions = await generate_behavioral_questions("Engineer", "mid", count=6)
        elif request.category == "situational":
            questions = await generate_situational_questions("Engineer", "software", count=6)
        else:
            # Search for more company questions
            questions = []
        
        # Filter out duplicates
        new_questions = []
        for q in questions:
            if q.get("question") not in existing:
                new_questions.append(InterviewQuestion(
                    question=q.get("question", ""),
                    answer=q.get("answer", ""),
                    category=request.category,
                    job_description=request.job_description,
                    source="ai_generated",
                    skill_tag=q.get("skill_tag"),
                    difficulty=q.get("difficulty", "medium")
                ))
        
        return {"questions": new_questions}
        
    except Exception as e:
        logger.error(f"Load more error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/favorites", response_model=List[FavoriteQuestion])
async def get_favorites():
    favorites = await db.favorites.find().sort("created_at", -1).to_list(1000)
    return [FavoriteQuestion(**fav) for fav in favorites]


@api_router.post("/favorites", response_model=FavoriteQuestion)
async def add_favorite(request: AddFavoriteRequest):
    favorite = FavoriteQuestion(
        question=request.question,
        answer=request.answer,
        category=request.category,
        job_description=request.job_description,
        source=request.source,
        source_url=request.source_url,
        company=request.company,
        skill_tag=request.skill_tag
    )
    await db.favorites.insert_one(favorite.model_dump())
    return favorite


@api_router.delete("/favorites/{favorite_id}")
async def remove_favorite(favorite_id: str):
    result = await db.favorites.delete_one({"id": favorite_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Favorite not found")
    return {"message": "Removed"}


# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
