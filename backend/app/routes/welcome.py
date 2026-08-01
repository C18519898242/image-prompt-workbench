from fastapi import APIRouter, Depends

from app.routes.auth import require_token

router = APIRouter(tags=["welcome"])


@router.get("/welcome")
def welcome(_: str = Depends(require_token)) -> dict[str, str]:
    return {"message": "欢迎使用 Image Prompt Workbench"}
