from dataclasses import dataclass


class ImageGenerationError(RuntimeError):
    """图片生成请求或响应无效。"""


@dataclass(frozen=True)
class ReferenceImage:
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class GeneratedImage:
    data: bytes
    mime_type: str
