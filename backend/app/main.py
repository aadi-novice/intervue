from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.api.role import router as role_router
from app.api.candidate import router as candidate_router
from app.api.analysis import (
    router as analysis_router
)

app = FastAPI(
    title="Intervue API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://intervue-rosy.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Intervue backend running"}

app.include_router(role_router)
app.include_router(candidate_router)
app.include_router(analysis_router)

# Serve uploaded files (avatars, resumes, transcripts)
os.makedirs("storage/avatars", exist_ok=True)
os.makedirs("storage/resumes", exist_ok=True)
os.makedirs("storage/transcripts", exist_ok=True)
app.mount("/storage", StaticFiles(directory="storage"), name="storage")