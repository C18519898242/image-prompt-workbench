from __future__ import annotations

from pathlib import Path
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel

from app.generation_history_repository import (
    GenerationHistory,
    GenerationHistoryRepository,
)
from app.prompt_card_images import MEDIA_URL_PREFIX
from app.prompt_card_repository import PromptCardRepository
from app.routes.auth import require_token

router = APIRouter(prefix="/generation-history", tags=["generation-history"])


class GenerationHistoryCreateRequest(BaseModel):
    prompt_card_id: int
    image_path: str
    model: str
    aspect_ratio: str
    resolution: str


class GenerationHistoryItem(BaseModel):
    id: int
    prompt_card_id: int
    title: str
    image_path: str
    url: str
    model: str
    aspect_ratio: str
    resolution: str
    created_at: int


class GenerationHistoryListResponse(BaseModel):
    items: list[GenerationHistoryItem]


def _generated_root(request: Request) -> Path:
    return (
        Path(request.app.state.settings.database_path).parent / "generated-images"
    ).resolve()


def _resolve_generated_image_path(
    request: Request,
    image_path: str,
    *,
    require_file: bool,
) -> Path:
    relative_path = Path(image_path)
    if (
        relative_path.is_absolute()
        or not relative_path.parts
        or relative_path.parts[0] != "generated-images"
        or ".." in relative_path.parts
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid generated image path",
        )

    data_root = Path(request.app.state.settings.database_path).parent.resolve()
    generated_root = _generated_root(request)
    resolved_path = (data_root / relative_path).resolve()
    try:
        resolved_path.relative_to(generated_root)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid generated image path",
        ) from error

    if require_file and not resolved_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Generated image file not found",
        )
    return resolved_path


def to_generation_history_item(history: GenerationHistory) -> GenerationHistoryItem:
    image_path = Path(history.image_path).as_posix()
    return GenerationHistoryItem(
        id=history.id,
        prompt_card_id=history.prompt_card_id,
        title=f"{history.prompt_card_title} {history.created_at}",
        image_path=image_path,
        url=f"{MEDIA_URL_PREFIX}/{image_path}",
        model=history.model,
        aspect_ratio=history.aspect_ratio,
        resolution=history.resolution,
        created_at=history.created_at,
    )


@router.post("", response_model=GenerationHistoryItem, status_code=201)
def create_history(
    payload: GenerationHistoryCreateRequest,
    request: Request,
    _: str = Depends(require_token),
) -> GenerationHistoryItem:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        prompt_cards = PromptCardRepository(connection)
        if prompt_cards.get_prompt_card(payload.prompt_card_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Prompt card not found",
            )

        _resolve_generated_image_path(
            request,
            payload.image_path,
            require_file=True,
        )
        repository = GenerationHistoryRepository(connection)
        history_id = repository.create_history(
            prompt_card_id=payload.prompt_card_id,
            image_path=payload.image_path,
            model=payload.model,
            aspect_ratio=payload.aspect_ratio,
            resolution=payload.resolution,
        )
        history = repository.get_history(history_id)
        if history is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="History record was not created",
            )
        return to_generation_history_item(history)
    finally:
        connection.close()


@router.get("", response_model=GenerationHistoryListResponse)
def list_history(
    request: Request,
    prompt_card_id: int | None = Query(default=None, ge=1),
    _: str = Depends(require_token),
) -> GenerationHistoryListResponse:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        repository = GenerationHistoryRepository(connection)
        return GenerationHistoryListResponse(
            items=[
                to_generation_history_item(history)
                for history in repository.list_histories(prompt_card_id)
            ]
        )
    finally:
        connection.close()


@router.get("/{history_id}", response_model=GenerationHistoryItem)
def get_history(
    history_id: int,
    request: Request,
    _: str = Depends(require_token),
) -> GenerationHistoryItem:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        history = GenerationHistoryRepository(connection).get_history(history_id)
        if history is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="History record not found",
            )
        return to_generation_history_item(history)
    finally:
        connection.close()


@router.delete("/{history_id}", status_code=204)
def delete_history(
    history_id: int,
    request: Request,
    _: str = Depends(require_token),
) -> Response:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        repository = GenerationHistoryRepository(connection)
        history = repository.get_history(history_id)
        if history is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="History record not found",
            )

        image_path = _resolve_generated_image_path(
            request,
            history.image_path,
            require_file=False,
        )
        try:
            image_path.unlink(missing_ok=True)
        except OSError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Generated image could not be deleted",
            ) from error

        if not repository.delete_history(history_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="History record not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    finally:
        connection.close()
