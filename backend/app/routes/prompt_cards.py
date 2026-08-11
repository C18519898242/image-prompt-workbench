from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from python_multipart.exceptions import MultipartParseError
from starlette.datastructures import FormData, UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException

from app.prompt_card_images import (
    build_public_image_refs,
    derive_image_paths,
    get_image_media_type,
)
from app.prompt_card_repository import (
    PromptCard,
    PromptCardInUseError,
    PromptCardRepository,
)
from app.prompt_card_request_guard import PromptCardRequestTooLarge
from app.prompt_card_uploads import (
    ImageSelection,
    MAX_IMAGE_BYTES,
    MAX_TOTAL_UPLOAD_BYTES,
    IncomingImage,
    PromptCardValidationError,
    parse_image_manifest,
)
from app.prompt_card_write_service import (
    PromptCardNotFoundError,
    PromptCardWriteService,
)
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


ERROR_STATUS = {
    "image_too_large": status.HTTP_413_CONTENT_TOO_LARGE,
    "total_too_large": status.HTTP_413_CONTENT_TOO_LARGE,
}
MAX_FORM_FIELDS = 3
MAX_NEW_IMAGE_FILES = 20
MAX_FORM_PART_BYTES = 64 * 1024
FORM_FIELDS = {"title", "prompt_text", "image_manifest", "new_images"}


def _validation_http_error(error: PromptCardValidationError) -> HTTPException:
    return HTTPException(
        status_code=ERROR_STATUS.get(error.code, status.HTTP_400_BAD_REQUEST),
        detail=str(error),
    )


async def _read_new_images(files: list[UploadFile]) -> tuple[IncomingImage, ...]:
    result: list[IncomingImage] = []
    total = 0
    for upload in files:
        content = await upload.read(MAX_IMAGE_BYTES + 1)
        if len(content) > MAX_IMAGE_BYTES:
            raise PromptCardValidationError(
                "image_too_large",
                "单张图片不能超过 20 MB",
            )
        total += len(content)
        if total > MAX_TOTAL_UPLOAD_BYTES:
            raise PromptCardValidationError(
                "total_too_large",
                "单次上传总量不能超过 100 MB",
            )
        result.append(IncomingImage(upload.filename or "image", content))
    return tuple(result)


def _single_text_field(form: FormData, name: str) -> str:
    values = form.getlist(name)
    if len(values) != 1 or not isinstance(values[0], str):
        raise PromptCardValidationError("invalid_form", "表单数据无效")
    return values[0]


async def _parse_prompt_card_form(
    request: Request,
) -> tuple[str, str, tuple[ImageSelection, ...], tuple[IncomingImage, ...]]:
    form: FormData | None = None
    try:
        form = await request.form(
            max_files=MAX_NEW_IMAGE_FILES,
            max_fields=MAX_FORM_FIELDS,
            max_part_size=MAX_FORM_PART_BYTES,
        )
        if any(name not in FORM_FIELDS for name in form):
            raise PromptCardValidationError("invalid_form", "表单数据无效")
        title = _single_text_field(form, "title")
        prompt_text = _single_text_field(form, "prompt_text")
        image_manifest = _single_text_field(form, "image_manifest")
        image_values = form.getlist("new_images")
        if any(not isinstance(value, UploadFile) for value in image_values):
            raise PromptCardValidationError("invalid_form", "表单数据无效")
        image_files = [
            value for value in image_values if isinstance(value, UploadFile)
        ]
        selections = parse_image_manifest(image_manifest)
        uploads = await _read_new_images(image_files)
        return title, prompt_text, selections, uploads
    except PromptCardRequestTooLarge:
        raise
    except PromptCardValidationError:
        raise
    except StarletteHTTPException as error:
        if error.status_code == status.HTTP_400_BAD_REQUEST:
            raise PromptCardValidationError(
                "invalid_form",
                "表单数据无效",
            ) from error
        raise
    except (MultiPartException, MultipartParseError) as error:
        raise PromptCardValidationError(
            "invalid_form",
            "表单数据无效",
        ) from error
    finally:
        if form is not None:
            await form.close()


def _category_map(repository: PromptCardRepository) -> dict[int, CategoryItem]:
    return {
        item.id: CategoryItem(
            id=item.id,
            name=item.name,
            sort_order=item.sort_order,
        )
        for item in repository.list_categories()
    }


@router.post(
    "/prompt-cards",
    response_model=PromptCardItem,
    status_code=status.HTTP_201_CREATED,
)
async def create_prompt_card(
    request: Request,
    _: str = Depends(require_token),
) -> PromptCardItem:
    connection: sqlite3.Connection | None = None
    try:
        title, prompt_text, selections, uploads = await _parse_prompt_card_form(request)
        settings = request.app.state.settings
        connection = sqlite3.connect(settings.database_path)
        repository = PromptCardRepository(connection)
        service = PromptCardWriteService(
            repository,
            Path(settings.image_directory),
        )
        card = service.create_card(
            title=title,
            prompt_text=prompt_text,
            selections=selections,
            uploads=uploads,
        )
        return _to_prompt_card_item(card, category_map=_category_map(repository))
    except PromptCardRequestTooLarge:
        raise
    except PromptCardValidationError as error:
        raise _validation_http_error(error) from error
    except Exception as error:
        logging.getLogger("app.prompt_cards").exception("创建提示词失败")
        raise HTTPException(status_code=500, detail="保存提示词失败") from error
    finally:
        if connection is not None:
            connection.close()


@router.put("/prompt-cards/{card_id}", response_model=PromptCardItem)
async def update_prompt_card(
    card_id: int,
    request: Request,
    _: str = Depends(require_token),
) -> PromptCardItem:
    connection: sqlite3.Connection | None = None
    try:
        title, prompt_text, selections, uploads = await _parse_prompt_card_form(request)
        settings = request.app.state.settings
        connection = sqlite3.connect(settings.database_path)
        repository = PromptCardRepository(connection)
        service = PromptCardWriteService(
            repository,
            Path(settings.image_directory),
        )
        card = service.update_card(
            card_id,
            title=title,
            prompt_text=prompt_text,
            selections=selections,
            uploads=uploads,
        )
        return _to_prompt_card_item(card, category_map=_category_map(repository))
    except PromptCardRequestTooLarge:
        raise
    except PromptCardNotFoundError as error:
        raise HTTPException(status_code=404, detail="提示词卡片不存在") from error
    except PromptCardValidationError as error:
        raise _validation_http_error(error) from error
    except Exception as error:
        logging.getLogger("app.prompt_cards").exception("编辑提示词失败")
        raise HTTPException(status_code=500, detail="保存提示词失败") from error
    finally:
        if connection is not None:
            connection.close()


@router.delete(
    "/prompt-cards/{card_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_prompt_card_route(
    card_id: int,
    request: Request,
    _: str = Depends(require_token),
) -> None:
    connection: sqlite3.Connection | None = None
    try:
        settings = request.app.state.settings
        connection = sqlite3.connect(settings.database_path)
        repository = PromptCardRepository(connection)
        service = PromptCardWriteService(
            repository,
            Path(settings.image_directory),
        )
        service.delete_card(card_id)
    except PromptCardNotFoundError as error:
        raise HTTPException(status_code=404, detail="提示词卡片不存在") from error
    except PromptCardInUseError as error:
        raise HTTPException(
            status_code=409,
            detail="该提示词存在生成历史，无法删除",
        ) from error
    except Exception as error:
        logging.getLogger("app.prompt_cards").exception("删除提示词失败")
        raise HTTPException(status_code=500, detail="删除提示词失败") from error
    finally:
        if connection is not None:
            connection.close()


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
