from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    auth_password_hash: str
    database_path: Path = PROJECT_ROOT / "data" / "app.db"
    image_directory: Path = PROJECT_ROOT / "data" / "prompt-images"
    gemini_api_key: str = ""
    gemini_base_url: str = "https://gemini.xyz365.tech/v1beta"
    gemini_model: str = "gemini-3.1-flash-image"

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
