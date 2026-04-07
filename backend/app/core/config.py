from pydantic_settings import BaseSettings
from functools import lru_cache
from pydantic import field_validator


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Propello CRM"
    DEBUG: bool = False
    API_PREFIX: str = "/api"

    # Database
    DATABASE_URL: str  # postgresql+asyncpg://user:pass@host/db
    DB_CONNECT_RETRIES: int = 12
    DB_CONNECT_RETRY_DELAY_SECONDS: int = 5

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        url = (value or "").strip().lower()
        if url.startswith("sqlite"):
            raise ValueError("SQLite is not supported. Use Supabase/PostgreSQL with postgresql+asyncpg://")
        if not url.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must start with postgresql+asyncpg://")
        return value

    # Auth
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # Twilio / WhatsApp
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_WHATSAPP_FROM: str = "whatsapp:+14155238886"

    # WATI WhatsApp
    WATI_API_KEY: str = ""
    WATI_BASE_URL: str = ""
    WHATSAPP_DEFAULT_COUNTRY_CODE: str = "91"

    # SendGrid
    SENDGRID_API_KEY: str = ""

    # Priya AI webhook secret
    PRIYA_WEBHOOK_SECRET: str = "priya-secret-change-in-prod"

    # Groq AI (for lead analysis engine)
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # Supabase
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    # Frontend URL (for CORS)
    FRONTEND_URL: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
