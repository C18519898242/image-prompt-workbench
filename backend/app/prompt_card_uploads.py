from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import json
from pathlib import Path
from typing import BinaryIO, Mapping, Sequence
import warnings

from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_IMAGE_COUNT = 20
MAX_IMAGE_WIDTH = 16_384
MAX_IMAGE_HEIGHT = 16_384
MAX_ALLOWED_IMAGE_PIXELS = 40_000_000
MAX_FINAL_IMAGE_PIXELS = 80_000_000
MAX_STAGED_OUTPUT_BYTES = 200 * 1024 * 1024


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
ImageSource = IncomingImage | Path


@dataclass(frozen=True)
class PreparedImages:
    extension: str
    sources: tuple[ImageSource, ...]

    @property
    def image_count(self) -> int:
        return len(self.sources)


class _OutputBudget:
    def __init__(self, maximum: int) -> None:
        self.maximum = maximum
        self.used = 0

    def consume(self, size: int) -> None:
        if self.used + size > self.maximum:
            raise PromptCardValidationError(
                "total_output_too_large",
                "最终图片暂存总量不能超过 200 MB",
            )
        self.used += size


class _BudgetedWriter:
    def __init__(self, output: BinaryIO, budget: _OutputBudget) -> None:
        self._output = output
        self._budget = budget

    def write(self, data: bytes) -> int:
        self._budget.consume(len(data))
        return self._output.write(data)

    def __getattr__(self, name: str):
        return getattr(self._output, name)


def _validate_image_dimensions(image: Image.Image) -> None:
    width, height = image.size
    if (
        width > MAX_IMAGE_WIDTH
        or height > MAX_IMAGE_HEIGHT
        or width * height > MAX_ALLOWED_IMAGE_PIXELS
    ):
        raise PromptCardValidationError("invalid_image", "图片尺寸过大")


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


def _open_image(source: ImageSource) -> Image.Image:
    if isinstance(source, Path):
        return Image.open(source)
    return Image.open(BytesIO(source.content))


def _detect_format(source: ImageSource) -> tuple[str, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with _open_image(source) as image:
                _validate_image_dimensions(image)
                pixels = image.width * image.height
                image.verify()
                format_name = image.format
    except PromptCardValidationError:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ) as error:
        raise PromptCardValidationError(
            "invalid_image", "图片文件已损坏或格式不受支持"
        ) from error
    if format_name not in {"JPEG", "PNG"}:
        raise PromptCardValidationError("invalid_image", "仅支持 JPG 和 PNG 图片")
    return format_name, pixels


def _write_png(
    source: ImageSource,
    destination: Path,
    budget: _OutputBudget,
) -> None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with _open_image(source) as image:
                _validate_image_dimensions(image)
                image.load()
                with destination.open("wb") as output:
                    image.save(_BudgetedWriter(output, budget), format="PNG")
    except PromptCardValidationError:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ) as error:
        raise PromptCardValidationError("invalid_image", "图片转换失败") from error


def _write_original(
    source: ImageSource,
    destination: Path,
    budget: _OutputBudget,
) -> None:
    try:
        with destination.open("wb") as output:
            writer = _BudgetedWriter(output, budget)
            if isinstance(source, IncomingImage):
                writer.write(source.content)
                return
            with source.open("rb") as existing:
                while chunk := existing.read(1024 * 1024):
                    writer.write(chunk)
    except PromptCardValidationError:
        raise
    except OSError as error:
        raise PromptCardValidationError("invalid_image", "图片暂存失败") from error


def stage_prepared_images(
    prepared: PreparedImages,
    directory: Path,
    prefix: str,
) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    budget = _OutputBudget(MAX_STAGED_OUTPUT_BYTES)
    paths: list[Path] = []
    try:
        for index, source in enumerate(prepared.sources, start=1):
            path = directory / f"{prefix}-{index:02d}{prepared.extension}"
            paths.append(path)
            if prepared.extension == ".png":
                _write_png(source, path, budget)
            else:
                _write_original(source, path, budget)
        return paths
    except Exception:
        for path in paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def prepare_final_images(
    selections: Sequence[ImageSelection],
    existing_images: Mapping[int, Path],
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

    sources: list[ImageSource] = []
    for selection in selections:
        if isinstance(selection, ExistingSelection):
            source = existing_images.get(selection.image_index)
            if source is None:
                raise PromptCardValidationError("invalid_manifest", "原图片引用不存在")
        else:
            if selection.file_index >= len(uploads):
                raise PromptCardValidationError("invalid_manifest", "上传图片引用不存在")
            source = uploads[selection.file_index]
        sources.append(source)

    formats: set[str] = set()
    total_pixels = 0
    for source in sources:
        format_name, pixels = _detect_format(source)
        formats.add(format_name)
        total_pixels += pixels
        if total_pixels > MAX_FINAL_IMAGE_PIXELS:
            raise PromptCardValidationError(
                "total_pixels_too_large",
                "最终图片总像素不能超过 8000 万",
            )
    extension = ".png" if "PNG" in formats else ".jpg"
    return PreparedImages(extension, tuple(sources))
