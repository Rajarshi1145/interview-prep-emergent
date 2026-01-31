from fastapi import FastAPI, APIRouter, HTTPException
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
from openai import OpenAI
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# OpenAI client
openai_client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Define Models
class InterviewQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    answer: str
    category: str  # technical, behavioral, situational
    job_description: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class GenerateQuestionsRequest(BaseModel):
    job_description: str

class GenerateQuestionsResponse(BaseModel):
    technical: List[InterviewQuestion]
    behavioral: List[InterviewQuestion]
    situational: List[InterviewQuestion]

class FavoriteQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    answer: str
    category: str
    job_description: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class AddFavoriteRequest(BaseModel):
    question: str
    answer: str
    category: str
    job_description: str

# Health check
@api_router.get("/")
async def root():
    return {"message": "Interview Prep API is running"}

# Generate interview questions
@api_router.post("/generate-questions", response_model=GenerateQuestionsResponse)
async def generate_questions(request: GenerateQuestionsRequest):
    try:
        prompt = f"""Based on the following job description, generate interview questions and comprehensive answers.

Job Description:
{request.job_description}

Generate exactly 4 questions for each category (technical, behavioral, situational).
For each question, provide a detailed, professional answer that a candidate could use.

Respond ONLY with a valid JSON object in this exact format (no markdown, no code blocks):
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

        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are an expert interview coach. Generate relevant, insightful interview questions and detailed answers. Always respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=4000
        )
        
        content = response.choices[0].message.content.strip()
        
        # Remove markdown code blocks if present
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if content.endswith("```"):
                content = content.rsplit("```", 1)[0]
            content = content.strip()
        
        questions_data = json.loads(content)
        
        # Convert to our models
        result = {
            "technical": [],
            "behavioral": [],
            "situational": []
        }
        
        for category in ["technical", "behavioral", "situational"]:
            for q in questions_data.get(category, []):
                question_obj = InterviewQuestion(
                    question=q["question"],
                    answer=q["answer"],
                    category=category,
                    job_description=request.job_description
                )
                result[category].append(question_obj)
        
        return result
        
    except json.JSONDecodeError as e:
        logging.error(f"JSON parsing error: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        logging.error(f"Error generating questions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Get all favorites
@api_router.get("/favorites", response_model=List[FavoriteQuestion])
async def get_favorites():
    favorites = await db.favorites.find().sort("created_at", -1).to_list(1000)
    return [FavoriteQuestion(**fav) for fav in favorites]

# Add to favorites
@api_router.post("/favorites", response_model=FavoriteQuestion)
async def add_favorite(request: AddFavoriteRequest):
    favorite = FavoriteQuestion(
        question=request.question,
        answer=request.answer,
        category=request.category,
        job_description=request.job_description
    )
    await db.favorites.insert_one(favorite.model_dump())
    return favorite

# Remove from favorites
@api_router.delete("/favorites/{favorite_id}")
async def remove_favorite(favorite_id: str):
    result = await db.favorites.delete_one({"id": favorite_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Favorite not found")
    return {"message": "Favorite removed successfully"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
