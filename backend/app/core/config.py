"""Central application settings. All env access goes through this module."""

from functools import lru_cache
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    environment: str = "development"

    # Database
    database_url: str = "postgresql+psycopg2://intervue:intervue123@localhost:5432/intervue_db"

    # HTTP
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]
    frontend_url: str = "http://localhost:3000"
    public_api_url: str = "http://localhost:8000"

    # Object storage (S3 API: AWS S3, R2, B2, MinIO)
    storage_backend: str = "s3"
    s3_bucket: str = "intervue-dev"
    s3_region: str = "us-east-1"
    s3_endpoint_url: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_presign_ttl_seconds: int = 900

    # LLM
    openai_api_key: str = ""
    model_resume_parse: str = "gpt-4.1-mini"
    model_analysis: str = "gpt-4.1-mini"
    model_rank: str = "gpt-4.1-mini"
    embedding_model: str = "text-embedding-3-small"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"
    celery_task_always_eager: bool = False

    # Security
    internal_hmac_secret: str = "dev-internal-secret"
    jwt_private_key: str = ""
    jwt_public_key: str = ""
    jwt_access_ttl_minutes: int = 15
    jwt_refresh_ttl_days: int = 30
    cookie_secure: bool = False
    cookie_domain: str | None = None
    # Path the refresh cookie is scoped to. Behind the Next.js /api proxy use /api/auth.
    refresh_cookie_path: str = "/auth"
    token_encryption_key: str = ""

    # OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""

    # Email
    email_backend: str = "console"  # console | smtp | ses
    email_from: str = "Intervue <no-reply@intervue.local>"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = None

    # Bots / transcriber
    # Base URL of this API as reachable from bot containers and the transcriber.
    internal_api_url: str = "http://host.docker.internal:8000"
    bot_launcher: str = "docker"  # docker | ecs | pool
    bot_image: str = "intervue-notetaker-bot:latest"
    bot_name: str = "Intervue Notetaker"
    bot_queue_name: str = "intervue:bot_sessions"
    bot_docker_network: str | None = None
    bot_docker_mem_limit: str = "2g"
    bot_docker_extra_hosts: bool = True  # map host.docker.internal on Linux
    bot_default_consent: str = (
        "Hi! Intervue Notetaker is recording and transcribing this meeting so the hiring team "
        "can take notes. If you do not agree, please tell the interviewer."
    )
    bot_max_duration_min: int = 180
    bot_admission_timeout_min: int = 10
    bot_alone_timeout_sec: int = 120
    bot_stuck_after_minutes: int = 240
    ecs_cluster: str = ""
    ecs_task_definition: str = ""
    ecs_subnets: Annotated[list[str], NoDecode] = []
    ecs_security_groups: Annotated[list[str], NoDecode] = []
    ecs_container_name: str = "bot"
    bot_concurrency_per_org: int = 3
    bot_concurrency_global: int = 20
    transcriber_mode: str = "local"  # local | api
    transcriber_url: str = "http://localhost:8100"
    transcriber_api_key: str = "dev-transcriber-key"
    transcriber_callback_secret: str = "dev-transcriber-secret"

    # Ranking
    rank_shortlist_k: int = 50

    # Observability
    sentry_dsn: str | None = None
    log_level: str = "INFO"

    @field_validator("ecs_subnets", "ecs_security_groups", mode="before")
    @classmethod
    def _split_csv(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
