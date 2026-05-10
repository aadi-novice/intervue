from fastapi import FastAPI

from app.api.role import router as role_router
from app.api.candidate import router as candidate_router

app = FastAPI(
    title="Intervue API",
    version="0.0.2"
    )


@app.get("/")
async def root():
    return {"message": "Intervue backend running"}

app.include_router(role_router)
app.include_router(candidate_router)