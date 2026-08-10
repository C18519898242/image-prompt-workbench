from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import json
from typing import Mapping, Sequence

from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_IMAGE_COUNT = 20


class PromptCardValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class IncomingImage:
    filename: str
    content: bytes


@dataclass(frozen=True)
class ExistingSelection:
    image_index: int


@dataclass(frozen=True)
class UploadSelection:
    file_index: int


ImageSelection = ExistingSelection | UploadSelection


@dataclass(frozen=True)
class PreparedImages:
    extension: str
    contents: tuple[bytes, ...]


def parse_image_manifest(raw: str) -> tuple[ImageSelection, ...]:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise PromptCardValidationError("invalid_manifest", "图片顺序数据无效") from error
    if not isinstance(payload, list):
        raise PromptCardValidationError("invalid_manifest", "图片顺序数据无效")
    if not payload:
        raise PromptCardValidationError("empty_images", "请至少上传一张示例图")
    if len(payload) > MAX_IMAGE_COUNT:
        raise PromptCardValidationError("too_many_images", "每张卡片最多上传 20 张图片")

    selections: list[ImageSelection] = []
    seen: set[tuple[str, int]] = set()
    for item in payload:
        if not isinstance(item, dict) or item.get("kind") not in {"existing", "upload"}:
            raise PromptCardValidationError("invalid_manifest", "图片顺序数据无效")
        field = "image_index" if item["kind"] == "existing" else "file_index"
        value = item.get(field)
        minimum = 1 if item["kind"] == "existing" else 0
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise PromptCardValidationError("invalid_manifest", "图片顺序数据无效")
        key = (item["kind"], value)
        if key in seen:
            raise PromptCardValidationError("invalid_manifest", "图片顺序数据存在重复引用")
        seen.add(key)
        selections.append(
            ExistingSelection(value) if item["kind"] == "existing" else UploadSelection(value)
        )
    return tuple(selections)


def _detect_format(content: bytes) -> str:
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
            format_name = image.format
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise PromptCardValidationError(
            "invalid_image", "图片文件已损坏或格式不受支持"
        ) from error
    if format_name not in {"JPEG", "PNG"}:
        raise PromptCardValidationError("invalid_image", "仅支持 JPG 和 PNG 图片")
    return format_name


def _encode_png(content: bytes) -> bytes:
    try:
        with Image.open(BytesIO(content)) as image:
            image.load()
            output = BytesIO()
            image.save(output, format="PNG")
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise PromptCardValidationError("invalid_image", "图片转换失败") from error


def prepare_final_images(
    selections: Sequence[ImageSelection],
    existing_images: Mapping[int, bytes],
    uploads: Sequence[IncomingImage],
) -> PreparedImages:
    if not selections:
        raise PromptCardValidationError("empty_images", "请至少上传一张示例图")
    if len(selections) > MAX_IMAGE_COUNT:
        raise PromptCardValidationError("too_many_images", "每张卡片最多上传 20 张图片")
    if any(len(upload.content) > MAX_IMAGE_BYTES for upload in uploads):
        raise PromptCardValidationError("image_too_large", "单张图片不能超过 20 MB")
    if sum(len(upload.content) for upload in uploads) > MAX_TOTAL_UPLOAD_BYTES:
        raise PromptCardValidationError("total_too_large", "单次上传总量不能超过 100 MB")

    referenced_uploads = {
        selection.file_index
        for selection in selections
        if isinstance(selection, UploadSelection)
    }
    if referenced_uploads != set(range(len(uploads))):
        raise PromptCardValidationError("invalid_manifest", "上传图片清单与文件不一致")

    contents: list[bytes] = []
    for selection in selections:
        if isinstance(selection, ExistingSelection):
            content = existing_images.get(selection.image_index)
            if content is None:
                raise PromptCardValidationError("invalid_manifest", "原图片引用不存在")
        else:
            if selection.file_index >= len(uploads):
                raise PromptCardValidationError("invalid_manifest", "上传图片引用不存在")
            content = uploads[selection.file_index].content
        contents.append(content)

    formats = [_detect_format(content) for content in contents]
    if "PNG" in formats:
        return PreparedImages(".png", tuple(_encode_png(content) for content in contents))
    return PreparedImages(".jpg", tuple(contents))
