from datetime import datetime
from pydantic import BaseModel


class RoleCreate(BaseModel):
    name: str
    experience_level: str
    experience_required_years: int

class RoleResponse(BaseModel):
    id: int
    name: str
    experience_level: str
    experience_required_years: int
    
    created_at: datetime

    model_config = {
        "from_attributes":True
    }