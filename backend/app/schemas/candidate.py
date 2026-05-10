from datetime import datetime
from typing import Optional

from pydantic import BaseModel,EmailStr

class CandidateCreate(BaseModel):
    name:str
    email: EmailStr
    role_id:int

class CandidateResponse(BaseModel):
    id:int
    name:str
    email:str
    status:str

    role_id:int

    resume_path: Optional[str]
    transcript_path: Optional[str]

    created_at: datetime

    model_config = {
        "from_attributes": True
    }