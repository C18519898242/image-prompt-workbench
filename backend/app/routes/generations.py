from __future__ import annotations

import logging
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status

from app.gemini_image_generator import GeminiImageError, ReferenceImage
from app.generation_history_repository import GenerationHistoryRepository
from app.prompt_card_repository import PromptCardRepository
from app.routes.auth import require_token
from app.routes.generation_history import (
    GenerationHistoryItem,
    to_generation_history_item,
)

router = APIRouter(prefix="/generations", tags=["generations"])
logger = logging.getLogger("app.generation")

ASPECT_RATIOS = {
    "Auto",
    "1:1",
    "9:16",
    "16:9",
    "3:4",
    "4:3",
    "3:2",
    "2:3",
    "5:4",
    "4:5",
    "21:9",
    "4:1",
    "1:4",
    "8:1",
    "1:8",
}
RESOLUTIONS = {"1K", "2K"}
THINKING_LEVELS = {"minimal", "high"}
REFERENCE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
OUTPUT_SUFFIXES = {"image/png": ".png", "image/jpeg": ".jpg"}


def read_references(uploads: list[UploadFile]) -> list[ReferenceImage]:
    if len(uploads) > 8:
        raise HTTPException(status_code=422, detail="最多上传 8 张参考图")
    references: list[ReferenceImage] = []
    for upload in uploads:
        mime_type = upload.content_type or ""
        if mime_type not in REFERENCE_MIME_TYPES:
            raise HTTPException(status_code=422, detail="不支持的参考图格式")
        data = upload.file.read()
        if not data:
            raise HTTPException(status_code=422, detail="参考图不能为空")
        references.append(ReferenceImage(mime_type=mime_type, data=data))
    return references


def write_generated_image(
    generated_directory: Path,
    data: bytes,
    mime_type: str,
) -> tuple[Path, str]:
    suffix = OUTPUT_SUFFIXES.get(mime_type)
    if suffix is None:
        raise GeminiImageError("Gemini 返回了不支持的图片格式")
    generated_directory.mkdir(parents=True, exist_ok=True)
    filename = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:12]}{suffix}"
    final_path = generated_directory / filename
    with tempfile.NamedTemporaryFile(
        mode="wb",
        delete=False,
        dir=generated_directory,
        suffix=".tmp",
    ) as temporary:
        temporary.write(data)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, final_path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise
    return final_path, f"generated-images/{filename}"


@router.post("", response_model=GenerationHistoryItem, status_code=201)
def create_generation(
    request: Request,
    prompt_card_id: int = Form(..., ge=1),
    prompt: str = Form(..., min_length=1),
    model: str = Form(...),
    aspect_ratio: str = Form(...),
    resolution: str = Form(...),
    thinking_level: str = Form(...),
    reference_images: list[UploadFile] = File(default=[]),
    _: str = Depends(require_token),
) -> GenerationHistoryItem:
    settings = request.app.state.settings
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="尚未配置 GEMINI_API_KEY")
    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        raise HTTPException(status_code=422, detail="提示词不能为空")
    if aspect_ratio not in ASPECT_RATIOS:
        raise HTTPException(status_code=422, detail="不支持的图片比例")
    if resolution not in RESOLUTIONS:
        raise HTTPException(status_code=422, detail="不支持的分辨率")
    if thinking_level not in THINKING_LEVELS:
        raise HTTPException(status_code=422, detail="不支持的思考级别")

    references = read_references(reference_images)
    connection = sqlite3.connect(settings.database_path)
    final_path: Path | None = None
    try:
        if PromptCardRepository(connection).get_prompt_card(prompt_card_id) is None:
            raise HTTPException(status_code=404, detail="Prompt card not found")
        generated = request.app.state.image_generator(
            api_key=settings.gemini_api_key,
            base_url=settings.gemini_base_url,
            model=settings.gemini_model,
            prompt=normalized_prompt,
            references=references,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            thinking_level=thinking_level,
        )
        final_path, image_path = write_generated_image(
            request.app.state.generated_image_directory,
            generated.data,
            generated.mime_type,
        )
        repository = GenerationHistoryRepository(connection)
        history_id = repository.create_history(
            prompt_card_id=prompt_card_id,
            image_path=image_path,
            model=model,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
        )
        history = repository.get_history(history_id)
        if history is None:
            raise RuntimeError("生成历史写入后无法读取")
        return to_generation_history_item(history)
    except HTTPException:
        raise
    except (GeminiImageError, OSError, sqlite3.Error, RuntimeError) as error:
        if final_path is not None:
            final_path.unlink(missing_ok=True)
        logger.exception(
            "图片生成失败 prompt_card_id=%s model=%s aspect_ratio=%s "
            "resolution=%s thinking_level=%s error=%s",
            prompt_card_id,
            settings.gemini_model,
            aspect_ratio,
            resolution,
            thinking_level,
            error,
        )
        raise HTTPException(
            status_code=502,
            detail="图片生成失败，请查看后台日志",
        ) from error
    finally:
        connection.close()
