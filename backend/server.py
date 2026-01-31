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
import asyncio
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
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============== DOMAIN PATTERNS ==============
# Define question patterns for different domains

DOMAIN_PATTERNS = {
    "software": {
        "name": "Software & IT",
        "technical_prompt": """Generate {count} CONCEPTUAL and SCENARIO-BASED technical questions for a {seniority} {title} role.
Skills to cover: {skills}

RULES:
- Ask about CONCEPTS, PRINCIPLES, and DESIGN DECISIONS
- Ask SCENARIO questions like "You're building a system that needs to handle X, how would you approach..."
- DO NOT ask to write code or implement functions
- Focus on: Architecture decisions, trade-offs, debugging approaches, system design, best practices
- Ask "Explain the difference between...", "When would you choose X over Y...", "How would you debug..."

Examples of GOOD questions:
- "Explain the trade-offs between SQL and NoSQL databases for a high-traffic e-commerce site"
- "You notice your React app is re-rendering frequently. What would be your debugging approach?"
- "When would you choose microservices over a monolithic architecture?"

Examples of BAD questions (DO NOT USE):
- "Write a function that..."
- "Implement a sorting algorithm..."
- "Code a REST API endpoint..."
""",
        "categories": ["Architecture & Design", "Debugging & Problem Solving", "Best Practices", "Trade-offs & Decisions"]
    },
    "engineering": {
        "name": "Engineering (Mechanical/Electrical/Civil)",
        "technical_prompt": """Generate {count} CONCEPTUAL and SCENARIO-BASED technical questions for a {seniority} {title} role.
Skills to cover: {skills}

RULES:
- Ask about ENGINEERING PRINCIPLES, ANALYSIS APPROACHES, and DESIGN DECISIONS
- Ask SCENARIO questions like "You're designing a component that must withstand X, how would you approach..."
- Focus on: Material selection rationale, failure analysis, optimization trade-offs, standards compliance
- Ask "Explain the principle behind...", "What factors would you consider when...", "How would you troubleshoot..."

Examples of GOOD questions:
- "Explain the factors you'd consider when selecting materials for a high-temperature aerospace application"
- "A component is failing prematurely in the field. Walk me through your failure analysis approach"
- "When would you use FEA vs hand calculations for stress analysis?"
""",
        "categories": ["Design Principles", "Analysis & Troubleshooting", "Standards & Compliance", "Material & Process Selection"]
    },
    "business": {
        "name": "Business & Management",
        "technical_prompt": """Generate {count} CONCEPTUAL and SCENARIO-BASED questions for a {seniority} {title} role.
Skills to cover: {skills}

RULES:
- Ask about BUSINESS CONCEPTS, STRATEGIC THINKING, and DECISION-MAKING
- Ask SCENARIO questions like "Your team is facing X challenge, how would you approach..."
- Focus on: Strategy formulation, stakeholder management, metrics/KPIs, process improvement
- Ask "Explain your approach to...", "What factors would influence your decision on...", "How would you measure success..."

Examples of GOOD questions:
- "Explain how you would approach entering a new market with limited budget"
- "Your quarterly targets are at risk. Walk me through your recovery strategy"
- "What KPIs would you prioritize for a new product launch and why?"
""",
        "categories": ["Strategy & Planning", "Leadership & Team Management", "Metrics & Analysis", "Stakeholder Management"]
    },
    "humanities": {
        "name": "Humanities & Education",
        "technical_prompt": """Generate {count} CONCEPTUAL and SCENARIO-BASED questions for a {seniority} {title} role.
Skills to cover: {skills}

RULES:
- Ask about THEORETICAL FRAMEWORKS, METHODOLOGICAL APPROACHES, and CRITICAL ANALYSIS
- Ask SCENARIO questions like "You're researching X topic, how would you approach..."
- Focus on: Research methodology, pedagogical approaches, analytical frameworks, ethical considerations
- Ask "Explain your theoretical approach to...", "How would you structure a course on...", "What methodology would you use..."

Examples of GOOD questions:
- "Explain how you would design a curriculum that addresses diverse learning styles"
- "You're evaluating conflicting historical sources. Walk me through your analytical approach"
- "What ethical considerations would guide your research methodology?"
""",
        "categories": ["Theoretical Frameworks", "Methodology & Research", "Pedagogy & Communication", "Critical Analysis"]
    },
    "healthcare": {
        "name": "Healthcare & Medical",
        "technical_prompt": """Generate {count} CONCEPTUAL and SCENARIO-BASED questions for a {seniority} {title} role.
Skills to cover: {skills}

RULES:
- Ask about CLINICAL REASONING, PATIENT CARE APPROACHES, and MEDICAL DECISION-MAKING
- Ask SCENARIO questions like "A patient presents with X symptoms, how would you approach..."
- Focus on: Diagnostic reasoning, treatment planning, patient communication, regulatory compliance
- Ask "Explain your clinical approach to...", "What factors would influence your treatment decision...", "How would you handle..."

Examples of GOOD questions:
- "Explain your approach to differential diagnosis when symptoms overlap multiple conditions"
- "A patient is non-compliant with treatment. How would you address this?"
- "What factors would you consider when balancing aggressive treatment vs quality of life?"
""",
        "categories": ["Clinical Reasoning", "Patient Care", "Regulatory & Compliance", "Communication & Ethics"]
    },
    "creative": {
        "name": "Creative & Design",
        "technical_prompt": """Generate {count} CONCEPTUAL and SCENARIO-BASED questions for a {seniority} {title} role.
Skills to cover: {skills}

RULES:
- Ask about DESIGN PRINCIPLES, CREATIVE PROCESS, and DECISION-MAKING
- Ask SCENARIO questions like "A client wants X but you think Y would be better, how would you handle..."
- Focus on: Design rationale, user-centered thinking, brand consistency, creative problem-solving
- Ask "Explain your design process for...", "How would you balance client requests with best practices...", "What principles guide..."

Examples of GOOD questions:
- "Explain how you approach designing for accessibility without compromising aesthetics"
- "A stakeholder disagrees with your design direction. How would you handle this?"
- "What factors influence your typography and color choices for different audiences?"
""",
        "categories": ["Design Principles", "Creative Process", "User-Centered Thinking", "Stakeholder Management"]
    }
}

def get_domain_pattern(domain: str, job_type: str) -> dict:
    """Get the appropriate question pattern for a domain."""
    domain_lower = (domain or "").lower()
    job_lower = (job_type or "").lower()
    
    if any(x in domain_lower or x in job_lower for x in ['software', 'developer', 'engineer', 'programming', 'it', 'data', 'devops', 'cloud', 'frontend', 'backend', 'fullstack']):
        return DOMAIN_PATTERNS["software"]
    elif any(x in domain_lower or x in job_lower for x in ['mechanical', 'electrical', 'civil', 'chemical', 'aerospace', 'manufacturing']):
        return DOMAIN_PATTERNS["engineering"]
    elif any(x in domain_lower or x in job_lower for x in ['business', 'management', 'marketing', 'sales', 'finance', 'consulting', 'hr', 'operations']):
        return DOMAIN_PATTERNS["business"]
    elif any(x in domain_lower or x in job_lower for x in ['education', 'teaching', 'professor', 'humanities', 'history', 'literature', 'philosophy']):
        return DOMAIN_PATTERNS["humanities"]
    elif any(x in domain_lower or x in job_lower for x in ['healthcare', 'medical', 'nursing', 'clinical', 'hospital', 'pharma']):
        return DOMAIN_PATTERNS["healthcare"]
    elif any(x in domain_lower or x in job_lower for x in ['design', 'creative', 'art', 'ux', 'ui', 'graphic', 'content', 'writer']):
        return DOMAIN_PATTERNS["creative"]
    else:
        return DOMAIN_PATTERNS["business"]  # Default to business pattern


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
    skill_tag: Optional[str] = None
    difficulty: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class GenerateQuestionsRequest(BaseModel):
    job_description: str

class LoadMoreRequest(BaseModel):
    job_description: str
    category: str
    existing_questions: List[str] = []
    skills: List[str] = []
    domain: str = "software"
    job_title: str = "Engineer"
    seniority: str = "mid"

class JobAnalysis(BaseModel):
    company_name: Optional[str] = None
    job_title: str
    industry: str
    seniority_level: str
    key_skills: List[str]
    technical_skills: List[str]
    soft_skills: List[str]
    job_type: str
    domain: str

class GenerateQuestionsResponse(BaseModel):
    technical: List[InterviewQuestion]
    behavioral: List[InterviewQuestion]
    situational: List[InterviewQuestion]
    company_specific: List[InterviewQuestion]
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


# ============== SERPAPI (PARALLEL) ==============

def search_with_serpapi_sync(query: str, num_results: int = 8) -> List[dict]:
    """Synchronous SerpAPI search."""
    try:
        if not SERPAPI_KEY:
            return []
        search = GoogleSearch({"q": query, "api_key": SERPAPI_KEY, "num": num_results})
        results = search.get_dict()
        return results.get("organic_results", [])
    except Exception as e:
        logger.error(f"SerpAPI error: {e}")
        return []


async def search_serpapi_async(query: str, num_results: int = 8) -> List[dict]:
    """Run SerpAPI search in thread pool for async compatibility."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, search_with_serpapi_sync, query, num_results)


async def parallel_skill_search(skills: List[str], seniority: str) -> List[dict]:
    """Search for questions for multiple skills IN PARALLEL."""
    all_results = []
    
    # Create search tasks for all skills at once
    tasks = []
    for skill in skills[:4]:  # Limit to 4 skills for speed
        query = f"{skill} interview questions {seniority} conceptual"
        tasks.append(search_serpapi_async(query, num_results=5))
    
    # Run all searches in parallel
    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for i, result in enumerate(results):
            if isinstance(result, list):
                for r in result:
                    r['skill'] = skills[i] if i < len(skills) else 'General'
                    all_results.append(r)
    
    return all_results


async def search_company_questions_parallel(company: str, role: str) -> List[dict]:
    """Search for company-specific questions."""
    queries = [
        f"{company} {role} interview questions Glassdoor",
        f"{company} interview experience site:glassdoor.com",
    ]
    
    tasks = [search_serpapi_async(q, 5) for q in queries]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    all_results = []
    for result in results:
        if isinstance(result, list):
            all_results.extend(result)
    
    return all_results


# ============== GEMINI FUNCTIONS ==============

async def analyze_job_fast(job_description: str) -> dict:
    """Quick job analysis - optimized for speed."""
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"analyze-{uuid.uuid4()}",
            system_message="Extract job info concisely."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Analyze this job description. Return ONLY JSON:

{job_description[:2000]}

{{"company_name": "name or null", "job_title": "title", "industry": "industry", "seniority_level": "junior/mid/senior", "domain": "software/engineering/business/humanities/healthcare/creative", "technical_skills": ["skill1", "skill2"], "soft_skills": ["skill1"], "key_skills": ["top 5"], "job_type": "specific type"}}"""

        response = await chat.send_message(UserMessage(text=prompt))
        content = response.strip()
        
        if "```" in content:
            content = re.search(r'\{.*\}', content, re.DOTALL).group()
        
        return json.loads(content, strict=False)
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        return {"company_name": None, "job_title": "Professional", "industry": "General", "seniority_level": "mid", "domain": "business", "technical_skills": [], "soft_skills": [], "key_skills": [], "job_type": "general"}


async def extract_questions_with_links(search_results: List[dict], domain_pattern: dict) -> List[dict]:
    """Extract questions from search results with source links."""
    if not search_results:
        return []
    
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"extract-{uuid.uuid4()}",
            system_message="Extract interview questions from search snippets."
        ).with_model("gemini", "gemini-2.5-flash")
        
        # Build search content with URLs
        snippets = []
        for r in search_results[:12]:
            snippets.append({
                "title": r.get("title", ""),
                "snippet": r.get("snippet", ""),
                "url": r.get("link", ""),
                "source": r.get("displayed_link", "").split("/")[0] if r.get("displayed_link") else "Web"
            })
        
        prompt = f"""Extract REAL interview questions from these search results.

{json.dumps(snippets, indent=2)}

Return ONLY JSON array. Include the source URL for each question:
[{{"question": "actual question from snippet", "answer": "brief suggested approach (2 sentences)", "source": "website name", "source_url": "full URL", "difficulty": "easy/medium/hard", "skill_tag": "relevant skill"}}]

Rules:
- Only extract questions ACTUALLY in the snippets
- Include the exact URL where you found each question
- Max 8 questions"""

        response = await chat.send_message(UserMessage(text=prompt))
        content = response.strip()
        
        if "```" in content:
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                content = match.group()
        
        return json.loads(content, strict=False)
    except Exception as e:
        logger.error(f"Extract error: {e}")
        return []


async def generate_domain_questions(
    skills: List[str],
    seniority: str,
    title: str,
    domain_pattern: dict,
    count: int = 6
) -> List[dict]:
    """Generate questions following domain-specific patterns."""
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"generate-{uuid.uuid4()}",
            system_message=f"You are an expert interviewer for {domain_pattern['name']} roles."
        ).with_model("gemini", "gemini-2.5-flash")
        
        skills_str = ", ".join(skills[:6]) if skills else "general skills"
        
        prompt = domain_pattern["technical_prompt"].format(
            count=count,
            seniority=seniority,
            title=title,
            skills=skills_str
        )
        
        prompt += f"""

Return ONLY JSON array:
[{{"question": "conceptual/scenario question", "answer": "suggested approach (3-4 sentences)", "skill_tag": "primary skill", "difficulty": "easy/medium/hard", "category": "one of {domain_pattern['categories']}"}}]"""

        response = await chat.send_message(UserMessage(text=prompt))
        content = response.strip()
        
        if "```" in content:
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                content = match.group()
        
        return json.loads(content, strict=False)
    except Exception as e:
        logger.error(f"Generate error: {e}")
        return []


async def generate_behavioral_quick(title: str, seniority: str) -> List[dict]:
    """Generate behavioral questions quickly."""
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"behavioral-{uuid.uuid4()}",
            system_message="Generate behavioral interview questions."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Generate 5 behavioral questions for a {seniority} {title}. Use STAR format focus.

Return ONLY JSON: [{{"question": "Tell me about a time...", "answer": "STAR approach suggestion", "difficulty": "medium"}}]"""

        response = await chat.send_message(UserMessage(text=prompt))
        content = response.strip()
        if "```" in content:
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                content = match.group()
        return json.loads(content, strict=False)
    except:
        return []


async def generate_situational_quick(title: str, domain: str) -> List[dict]:
    """Generate situational questions quickly."""
    try:
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"situational-{uuid.uuid4()}",
            system_message="Generate situational interview questions."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Generate 5 situational questions for a {title} in {domain}. 

Return ONLY JSON: [{{"question": "What would you do if...", "answer": "suggested approach", "difficulty": "medium"}}]"""

        response = await chat.send_message(UserMessage(text=prompt))
        content = response.strip()
        if "```" in content:
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                content = match.group()
        return json.loads(content, strict=False)
    except:
        return []


# ============== FILE EXTRACTION ==============

async def extract_text_from_image(image_base64: str) -> str:
    try:
        chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"ocr-{uuid.uuid4()}", system_message="Extract text from images.").with_model("gemini", "gemini-2.5-flash")
        message = UserMessage(text="Extract ALL text from this job posting.", file_contents=[ImageContent(image_base64=image_base64)])
        return (await chat.send_message(message)).strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def extract_text_from_pdf(pdf_content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(pdf_content))
        return "\n".join(page.extract_text() for page in reader.pages).strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== API ROUTES ==============

@api_router.get("/")
async def root():
    return {"message": "Interview Prep API v4 - Parallel & Domain-Specific"}


@api_router.post("/extract-text", response_model=ExtractTextResponse)
async def extract_text(file: UploadFile = File(...)):
    content = await file.read()
    filename = file.filename.lower() if file.filename else ""
    if filename.endswith('.pdf'):
        return ExtractTextResponse(extracted_text=extract_text_from_pdf(content), source_type="pdf")
    elif any(filename.endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.webp']):
        return ExtractTextResponse(extracted_text=await extract_text_from_image(base64.b64encode(content).decode('utf-8')), source_type="image")
    raise HTTPException(status_code=400, detail="Unsupported file type")


@api_router.post("/extract-text-base64")
async def extract_text_base64(image_base64: str = Form(...)):
    if ',' in image_base64:
        image_base64 = image_base64.split(',')[1]
    return {"extracted_text": await extract_text_from_image(image_base64), "source_type": "image"}


@api_router.post("/generate-questions", response_model=GenerateQuestionsResponse)
async def generate_questions(request: GenerateQuestionsRequest):
    """Generate questions with PARALLEL processing for speed."""
    
    try:
        # Step 1: Quick job analysis
        job_analysis = await analyze_job_fast(request.job_description)
        logger.info(f"Analysis: {job_analysis.get('job_title')} at {job_analysis.get('company_name')}")
        
        company = job_analysis.get("company_name")
        title = job_analysis.get("job_title", "Professional")
        seniority = job_analysis.get("seniority_level", "mid")
        domain = job_analysis.get("domain", "business")
        job_type = job_analysis.get("job_type", "general")
        skills = job_analysis.get("technical_skills", [])
        
        # Get domain-specific pattern
        domain_pattern = get_domain_pattern(domain, job_type)
        logger.info(f"Using pattern: {domain_pattern['name']}")
        
        # Step 2: Run ALL searches and generation IN PARALLEL
        tasks = [
            parallel_skill_search(skills, seniority),  # Search skills
            generate_domain_questions(skills, seniority, title, domain_pattern, count=8),  # AI questions
            generate_behavioral_quick(title, seniority),  # Behavioral
            generate_situational_quick(title, domain),  # Situational
        ]
        
        # Add company search if company is known
        if company:
            tasks.append(search_company_questions_parallel(company, title))
        
        # Execute all in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Unpack results
        skill_search_results = results[0] if isinstance(results[0], list) else []
        ai_questions = results[1] if isinstance(results[1], list) else []
        behavioral = results[2] if isinstance(results[2], list) else []
        situational = results[3] if isinstance(results[3], list) else []
        company_search = results[4] if len(results) > 4 and isinstance(results[4], list) else []
        
        # Step 3: Extract real questions from search results (in parallel)
        extract_tasks = [
            extract_questions_with_links(skill_search_results, domain_pattern),
        ]
        if company_search:
            extract_tasks.append(extract_questions_with_links(company_search, domain_pattern))
        
        extract_results = await asyncio.gather(*extract_tasks, return_exceptions=True)
        
        real_questions = extract_results[0] if isinstance(extract_results[0], list) else []
        company_questions = extract_results[1] if len(extract_results) > 1 and isinstance(extract_results[1], list) else []
        
        # Build response
        def to_question(q: dict, category: str, source: str = "ai_generated") -> InterviewQuestion:
            return InterviewQuestion(
                question=q.get("question", ""),
                answer=q.get("answer", ""),
                category=category,
                job_description=request.job_description,
                source=source,
                source_url=q.get("source_url") or q.get("source"),
                company=company,
                skill_tag=q.get("skill_tag"),
                difficulty=q.get("difficulty", "medium")
            )
        
        # Combine real + AI technical questions
        all_technical = []
        for q in real_questions:
            all_technical.append(to_question(q, "technical", "web_search"))
        for q in ai_questions:
            all_technical.append(to_question(q, "technical", "ai_generated"))
        
        return GenerateQuestionsResponse(
            technical=all_technical,
            behavioral=[to_question(q, "behavioral") for q in behavioral],
            situational=[to_question(q, "situational") for q in situational],
            company_specific=[to_question(q, "company_specific", "web_search") for q in company_questions],
            job_analysis=JobAnalysis(**job_analysis)
        )
        
    except Exception as e:
        logger.error(f"Generate error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/load-more")
async def load_more_questions(request: LoadMoreRequest):
    """Load more questions of a specific category."""
    try:
        existing = set(request.existing_questions)
        domain_pattern = get_domain_pattern(request.domain, request.job_title)
        
        if request.category == "technical":
            questions = await generate_domain_questions(
                request.skills, request.seniority, request.job_title, domain_pattern, count=5
            )
        elif request.category == "behavioral":
            questions = await generate_behavioral_quick(request.job_title, request.seniority)
        else:
            questions = await generate_situational_quick(request.job_title, request.domain)
        
        new_questions = [
            InterviewQuestion(
                question=q.get("question", ""),
                answer=q.get("answer", ""),
                category=request.category,
                job_description=request.job_description,
                source="ai_generated",
                skill_tag=q.get("skill_tag"),
                difficulty=q.get("difficulty", "medium")
            )
            for q in questions if q.get("question") not in existing
        ]
        
        return {"questions": new_questions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/favorites", response_model=List[FavoriteQuestion])
async def get_favorites():
    favorites = await db.favorites.find().sort("created_at", -1).to_list(1000)
    return [FavoriteQuestion(**fav) for fav in favorites]


@api_router.post("/favorites", response_model=FavoriteQuestion)
async def add_favorite(request: AddFavoriteRequest):
    favorite = FavoriteQuestion(**request.model_dump())
    await db.favorites.insert_one(favorite.model_dump())
    return favorite


@api_router.delete("/favorites/{favorite_id}")
async def remove_favorite(favorite_id: str):
    result = await db.favorites.delete_one({"id": favorite_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Removed"}


app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
