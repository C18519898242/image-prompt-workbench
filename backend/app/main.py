from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI

from app.auth import AuthState
from app.config import Settings, get_settings
from app.gemini_image_generator import generate_image
from app.routes.auth import router as auth_router
from app.routes.generation_history import router as generation_history_router
from app.routes.generations import router as generations_router
from app.routes.prompt_cards import router as prompt_cards_router
from app.routes.welcome import router as welcome_router


def configure_generation_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("app.generation")
    logger.setLevel(logging.INFO)
    resolved = str(log_path.resolve())
    if any(
        getattr(handler, "generation_log_path", None) == resolved
        for handler in logger.handlers
    ):
        return
    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.generation_log_path = resolved  # type: ignore[attr-defined]
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logger.addHandler(handler)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    application = FastAPI(title="Image Prompt Workbench API")
    application.state.settings = resolved_settings
    application.state.auth_state = AuthState(resolved_settings.auth_password_hash)
    application.state.image_generator = generate_image
    data_root = Path(resolved_settings.database_path).parent
    application.state.generated_image_directory = data_root / "generated-images"
    application.state.generation_log_path = data_root / "logs" / "app.log"
    configure_generation_logging(application.state.generation_log_path)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    application.include_router(auth_router, prefix="/api")
    application.include_router(welcome_router, prefix="/api")
    application.include_router(prompt_cards_router, prefix="/api")
    application.include_router(generation_history_router, prefix="/api")
    application.include_router(generations_router, prefix="/api")
    return application


app = create_app()
