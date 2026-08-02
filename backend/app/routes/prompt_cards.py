from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.prompt_card_images import (
    build_public_image_refs,
    derive_image_paths,
    get_image_media_type,
)
from app.prompt_card_repository import PromptCard, PromptCardRepository
from app.routes.auth import require_token

router = APIRouter(tags=["prompt-cards"])


class PromptCardImageItem(BaseModel):
    index: int
    path: str
    url: str


class CategoryItem(BaseModel):
    id: int
    name: str
    sort_order: int


class CategoryListResponse(BaseModel):
    items: list[CategoryItem]


class PromptCardItem(BaseModel):
    id: int
    title: str
    prompt_text: str
    sort_order: int
    category_ids: list[int]
    categories: list[CategoryItem]
    image_count: int
    example_image_path: str
    images: list[PromptCardImageItem]


class PromptCardListResponse(BaseModel):
    items: list[PromptCardItem]


@router.get("/categories", response_model=CategoryListResponse)
def list_categories(
    request: Request,
    _: str = Depends(require_token),
) -> CategoryListResponse:
    settings = request.app.state.settings
    connection = sqlite3.connect(settings.database_path)
    try:
        repository = PromptCardRepository(connection)
        items = [
            CategoryItem(id=category.id, name=category.name, sort_order=category.sort_order)
            for category in repository.list_categories()
        ]
        return CategoryListResponse(items=items)
    finally:
        connection.close()


@router.get("/prompt-cards", response_model=PromptCardListResponse)
def list_prompt_cards(
    request: Request,
    _: str = Depends(require_token),
) -> PromptCardListResponse:
    settings = request.app.state.settings
    connection = sqlite3.connect(settings.database_path)
    try:
        repository = PromptCardRepository(connection)
        category_map = {
            category.id: CategoryItem(
                id=category.id,
                name=category.name,
                sort_order=category.sort_order,
            )
            for category in repository.list_categories()
        }
        cards = repository.list_prompt_cards()
        return PromptCardListResponse(
            items=[
                _to_prompt_card_item(card, category_map=category_map) for card in cards
            ]
        )
    finally:
        connection.close()


@router.get("/prompt-cards/{card_id}/images/{image_index}")
def get_prompt_card_image(
    card_id: int,
    image_index: int,
    request: Request,
    _: str = Depends(require_token),
) -> FileResponse:
    """兼容旧客户端：仍可通过鉴权 API 读取图片文件。

    浏览器展示优先使用列表接口返回的 /media/... 静态 URL。
    """
    settings = request.app.state.settings
    connection = sqlite3.connect(settings.database_path)
    try:
        repository = PromptCardRepository(connection)
        card = repository.get_prompt_card(card_id)
    finally:
        connection.close()

    if card is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt card not found",
        )
    if image_index < 1 or image_index > card.image_count:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    try:
        paths = derive_image_paths(
            card.example_image_path,
            card.image_count,
            Path(settings.image_directory),
        )
        image_path = paths[image_index - 1]
        media_type = get_image_media_type(image_path)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        ) from error

    if not image_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    return FileResponse(image_path, media_type=media_type)


def _to_prompt_card_item(
    card: PromptCard,
    *,
    category_map: dict[int, CategoryItem] | None = None,
) -> PromptCardItem:
    try:
        refs = build_public_image_refs(card.example_image_path, card.image_count)
    except ValueError:
        refs = []

    images = [
        PromptCardImageItem(index=index, path=path, url=url)
        for index, path, url in refs
    ]
    resolved_map = category_map or {}
    categories = [
        resolved_map[category_id]
        for category_id in card.category_ids
        if category_id in resolved_map
    ]
    return PromptCardItem(
        id=card.id,
        title=card.title,
        prompt_text=card.prompt_text,
        sort_order=card.sort_order,
        category_ids=list(card.category_ids),
        categories=categories,
        image_count=card.image_count,
        example_image_path=card.example_image_path,
        images=images,
    )
