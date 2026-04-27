from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = Field("", alias="DATABASE_URL")
    gemini_api_key: str = Field("", alias="GEMINI_API_KEY")
    port: int = Field(8095, alias="PORT")
    host: str = Field("0.0.0.0", alias="HOST")
    environment: str = Field("development", alias="ENVIRONMENT")
    log_level: str = Field("INFO", alias="LOG_LEVEL")

    model_config = {"env_file": ".env", "populate_by_name": True}


@lru_cache
def get_settings() -> Settings:
    return Settings()
