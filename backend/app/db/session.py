from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

import os

load_dotenv()

# Use Supabase DB_CONNECTION; fall back to local DATABASE_URL for dev convenience
DATABASE_URL = os.getenv("DB_CONNECTION") or os.getenv("DATABASE_URL")

engine = create_engine(
    DATABASE_URL,
    connect_args={"sslmode": "require"},  # Supabase requires SSL
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)