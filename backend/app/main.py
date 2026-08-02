from fastapi import FastAPI

from app.auth import AuthState
from app.config import Settings, get_settings
from app.routes.auth import router as auth_router
from app.routes.prompt_cards import router as prompt_cards_router
from app.routes.welcome import router as welcome_router


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    application = FastAPI(title="Image Prompt Workbench API")
    application.state.settings = resolved_settings
    application.state.auth_state = AuthState(resolved_settings.auth_password_hash)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    application.include_router(auth_router, prefix="/api")
    application.include_router(welcome_router, prefix="/api")
    application.include_router(prompt_cards_router, prefix="/api")
    return application


app = create_app()
