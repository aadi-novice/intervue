from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

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
    allow_origins=settings.cors_origins,
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