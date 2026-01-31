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
import aiohttp
import re
from PyPDF2 import PdfReader
import io
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Gemini API key
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Models
class InterviewQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    answer: str
    category: str
    job_description: str
    source: Optional[str] = None  # 'ai_generated' or 'web_search'
    source_url: Optional[str] = None
    company: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class GenerateQuestionsRequest(BaseModel):
    job_description: str

class JobAnalysis(BaseModel):
    company_name: Optional[str] = None
    job_title: str
    industry: str
    seniority_level: str
    key_skills: List[str]
    job_type: str
    search_terms: List[str]

class GenerateQuestionsResponse(BaseModel):
    technical: List[InterviewQuestion]
    behavioral: List[InterviewQuestion]
    situational: List[InterviewQuestion]
    web_sourced: List[InterviewQuestion]  # Real questions from web search
    job_analysis: Optional[JobAnalysis] = None  # Extracted job info

class FavoriteQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    answer: str
    category: str
    job_description: str
    source: Optional[str] = None
    source_url: Optional[str] = None
    company: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class AddFavoriteRequest(BaseModel):
    question: str
    answer: str
    category: str
    job_description: str
    source: Optional[str] = None
    source_url: Optional[str] = None
    company: Optional[str] = None

class ExtractTextResponse(BaseModel):
    extracted_text: str
    source_type: str  # 'pdf' or 'image'


async def search_real_interview_questions(company_name: str, job_title: str) -> List[dict]:
    """
    Search for real interview questions from the web using Gemini with grounding.
    Returns questions from sources like Glassdoor, Indeed, LeetCode, etc.
    """
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"web-search-{uuid.uuid4()}",
            system_message="You are a research assistant that finds real interview questions from reliable sources."
        ).with_model("gemini", "gemini-2.5-flash")
        
        search_prompt = f"""Search the web for REAL interview questions asked at {company_name} for {job_title} positions.

Look for questions from these sources:
- Glassdoor interview reviews
- Indeed interview questions
- LeetCode discuss (for technical roles)
- Blind app discussions
- Company-specific interview prep sites

For each question found, provide:
1. The actual question asked
2. A suggested answer approach
3. The source (website name)
4. Category (technical, behavioral, or situational)

Return ONLY a valid JSON array with this format (no markdown, no code blocks):
[
  {{
    "question": "Actual interview question from the source",
    "answer": "Suggested answer approach",
    "source": "Source website name",
    "category": "technical|behavioral|situational"
  }}
]

Find at least 6-8 real questions if available. If you cannot find specific questions for this company, search for similar companies in the same industry."""

        response = await chat.send_message(UserMessage(text=search_prompt))
        
        # Clean and parse response
        content = response.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if content.endswith("```"):
                content = content.rsplit("```", 1)[0]
            content = content.strip()
        
        # Try to find JSON array in response
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        
        # Clean control characters that might break JSON parsing
        content = re.sub(r'[\x00-\x1f\x7f-\x9f]', ' ', content)
        
        questions = json.loads(content)
        return questions if isinstance(questions, list) else []
        
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return []


async def generate_ai_questions(job_description: str, company_name: Optional[str] = None) -> dict:
    """
    Generate interview questions using Gemini AI.
    """
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"generate-{uuid.uuid4()}",
            system_message="You are an expert interview coach who creates relevant, insightful interview questions."
        ).with_model("gemini", "gemini-2.5-flash")
        
        company_context = f" at {company_name}" if company_name else ""
        
        prompt = f"""Based on the following job description{company_context}, generate interview questions and comprehensive answers.

Job Description:
{job_description}

Generate exactly 4 questions for each category (technical, behavioral, situational).
For each question, provide a detailed, professional answer.

Respond ONLY with a valid JSON object (no markdown, no code blocks):
{{
    "technical": [
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}}
    ],
    "behavioral": [
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}}
    ],
    "situational": [
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}},
        {{"question": "...", "answer": "..."}}
    ]
}}"""

        response = await chat.send_message(UserMessage(text=prompt))
        
        content = response.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if content.endswith("```"):
                content = content.rsplit("```", 1)[0]
            content = content.strip()
        
        # Try to find JSON object in response
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        
        # Use strict=False to handle control characters
        try:
            return json.loads(content, strict=False)
        except json.JSONDecodeError:
            # Try to repair common JSON issues
            # Remove trailing commas before closing brackets
            content = re.sub(r',(\s*[\}\]])', r'\1', content)
            return json.loads(content, strict=False)
        
    except Exception as e:
        logger.error(f"AI generation error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate questions: {str(e)}")


async def extract_text_from_image(image_base64: str) -> str:
    """
    Extract text from an image using Gemini Vision.
    """
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"ocr-{uuid.uuid4()}",
            system_message="You are an OCR assistant that extracts text from images accurately."
        ).with_model("gemini", "gemini-2.5-flash")
        
        image_content = ImageContent(image_base64=image_base64)
        
        message = UserMessage(
            text="Extract ALL text from this image. This is a job posting or job description. Return only the extracted text, preserving the structure and formatting as much as possible. Include all details like job title, company name, requirements, responsibilities, etc.",
            file_contents=[image_content]
        )
        
        response = await chat.send_message(message)
        return response.strip()
        
    except Exception as e:
        logger.error(f"Image OCR error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract text from image: {str(e)}")


def extract_text_from_pdf(pdf_content: bytes) -> str:
    """
    Extract text from a PDF file.
    """
    try:
        pdf_reader = PdfReader(io.BytesIO(pdf_content))
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract text from PDF: {str(e)}")


def extract_company_and_role(text: str) -> tuple:
    """
    Try to extract company name and job role from text.
    """
    # Common patterns
    company_patterns = [
        r'(?:at|@|company:?)\s*([A-Z][A-Za-z0-9\s&]+?)(?:\n|,|\.|\s{2})',
        r'^([A-Z][A-Za-z0-9\s&]+?)\s*(?:is hiring|is looking|seeks)',
    ]
    role_patterns = [
        r'(?:position|role|title|job):?\s*([A-Za-z\s]+?)(?:\n|,|\.|\s{2})',
        r'^([A-Za-z\s]+(?:Engineer|Developer|Manager|Designer|Analyst|Scientist|Director))'
    ]
    
    company = None
    role = None
    
    for pattern in company_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            company = match.group(1).strip()
            break
    
    for pattern in role_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            role = match.group(1).strip()
            break
    
    return company, role


async def analyze_job_description(job_description: str) -> dict:
    """
    Use Gemini to intelligently analyze job description and extract key info.
    """
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"analyze-{uuid.uuid4()}",
            system_message="You are an expert at analyzing job descriptions."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Analyze this job description and extract key information.

Job Description:
{job_description}

Return ONLY a valid JSON object (no markdown, no code blocks):
{{
    "company_name": "Company name if mentioned, or null",
    "job_title": "The job title/role",
    "industry": "Industry sector (tech, finance, healthcare, entertainment, retail, etc.)",
    "seniority_level": "junior, mid, senior, lead, or executive",
    "key_skills": ["skill1", "skill2", "skill3"],
    "job_type": "engineering, product, design, data, marketing, operations, etc.",
    "search_terms": ["term1", "term2", "term3"]
}}

For search_terms, provide 3 specific terms that would be most useful for finding real interview questions for this role. Be specific - include company name if available, role type, and key technical areas."""

        response = await chat.send_message(UserMessage(text=prompt))
        
        content = response.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if content.endswith("```"):
                content = content.rsplit("```", 1)[0]
            content = content.strip()
        
        # Find JSON object
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
            "key_skills": [],
            "job_type": "engineering",
            "search_terms": ["software engineer interview questions"]
        }


# Routes
@api_router.get("/")
async def root():
    return {"message": "Interview Prep API v2 - with Web Search & File Upload"}


@api_router.post("/extract-text", response_model=ExtractTextResponse)
async def extract_text(
    file: UploadFile = File(...)
):
    """Extract text from uploaded PDF or image file."""
    
    content = await file.read()
    filename = file.filename.lower() if file.filename else ""
    
    if filename.endswith('.pdf'):
        extracted = extract_text_from_pdf(content)
        return ExtractTextResponse(extracted_text=extracted, source_type="pdf")
    elif any(filename.endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.webp']):
        # Convert to base64 for Gemini Vision
        image_base64 = base64.b64encode(content).decode('utf-8')
        extracted = await extract_text_from_image(image_base64)
        return ExtractTextResponse(extracted_text=extracted, source_type="image")
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload PDF, PNG, JPG, or WEBP.")


@api_router.post("/extract-text-base64")
async def extract_text_base64(image_base64: str = Form(...)):
    """Extract text from base64 encoded image."""
    # Remove data URL prefix if present
    if ',' in image_base64:
        image_base64 = image_base64.split(',')[1]
    
    extracted = await extract_text_from_image(image_base64)
    return {"extracted_text": extracted, "source_type": "image"}


@api_router.post("/generate-questions", response_model=GenerateQuestionsResponse)
async def generate_questions(request: GenerateQuestionsRequest):
    """Generate interview questions from job description with intelligent analysis."""
    
    try:
        # Step 1: Analyze job description to extract key info
        job_analysis = await analyze_job_description(request.job_description)
        
        company_name = job_analysis.get("company_name")
        job_title = job_analysis.get("job_title", "Software Engineer")
        search_terms = job_analysis.get("search_terms", [])
        
        logger.info(f"Job Analysis: company={company_name}, title={job_title}, terms={search_terms}")
        
        # Step 2: Generate AI questions based on full analysis
        ai_questions = await generate_ai_questions(request.job_description, company_name)
        
        # Step 3: Search for real questions using extracted info
        web_questions = []
        
        # Search using company + role if available
        if company_name and job_title:
            raw_web_questions = await search_real_interview_questions(company_name, job_title)
            for q in raw_web_questions:
                web_questions.append(InterviewQuestion(
                    question=q.get("question", ""),
                    answer=q.get("answer", ""),
                    category=q.get("category", "general"),
                    job_description=request.job_description,
                    source="web_search",
                    source_url=q.get("source", "Web Search"),
                    company=company_name
                ))
        elif job_title:
            # No company, just search by role
            raw_web_questions = await search_real_interview_questions("top tech companies", job_title)
            for q in raw_web_questions:
                web_questions.append(InterviewQuestion(
                    question=q.get("question", ""),
                    answer=q.get("answer", ""),
                    category=q.get("category", "general"),
                    job_description=request.job_description,
                    source="web_search",
                    source_url=q.get("source", "Web Search"),
                    company=None
                ))
        
        # Convert AI questions to InterviewQuestion objects
        result = {
            "technical": [],
            "behavioral": [],
            "situational": [],
            "web_sourced": web_questions,
            "job_analysis": JobAnalysis(**job_analysis) if job_analysis else None
        }
        
        for category in ["technical", "behavioral", "situational"]:
            for q in ai_questions.get(category, []):
                question_obj = InterviewQuestion(
                    question=q["question"],
                    answer=q["answer"],
                    category=category,
                    job_description=request.job_description,
                    source="ai_generated",
                    company=company_name
                )
                result[category].append(question_obj)
        
        return result
        
    except Exception as e:
        logger.error(f"Error generating questions: {e}")
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
        company=request.company
    )
    await db.favorites.insert_one(favorite.model_dump())
    return favorite


@api_router.delete("/favorites/{favorite_id}")
async def remove_favorite(favorite_id: str):
    result = await db.favorites.delete_one({"id": favorite_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Favorite not found")
    return {"message": "Favorite removed successfully"}


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
