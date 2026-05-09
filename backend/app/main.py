from fastapi import FastAPI

app = FastAPI(title="Intervue API")


@app.get("/")
async def root():
    return {"message": "Intervue backend running"}