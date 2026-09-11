from __future__ import annotations

import base64
import binascii
import io
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, TypeAlias
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger("app.generation")


class GeminiImageError(RuntimeError):
    """Gemini 图片请求或响应无效。"""


class GeminiHttpError(GeminiImageError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


@dataclass(frozen=True)
class ReferenceImage:
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class GeneratedImage:
    data: bytes
    mime_type: str


Transport: TypeAlias = Callable[
    [str, dict[str, str], dict[str, Any], float],
    dict[str, Any],
]


def build_generation_request(
    *,
    prompt: str,
    references: list[ReferenceImage],
    aspect_ratio: str,
    resolution: str,
    thinking_level: str,
) -> dict[str, Any]:
    image_config = {"imageSize": resolution}
    if aspect_ratio != "Auto":
        image_config["aspectRatio"] = aspect_ratio
    parts: list[dict[str, Any]] = [{"text": prompt}]
    parts.extend(
        {
            "inlineData": {
                "mimeType": reference.mime_type,
                "data": base64.b64encode(reference.data).decode("ascii"),
            }
        }
        for reference in references
    )
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": image_config,
            "thinkingConfig": {"thinkingLevel": thinking_level},
        },
    }


def extract_image(response: dict[str, Any]) -> GeneratedImage:
    candidates = response.get("candidates")
    if not isinstance(candidates, list):
        raise GeminiImageError("Gemini 没有返回图片")
    for candidate in candidates:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData", part.get("inline_data"))
            if not isinstance(inline, dict):
                continue
            mime_type = inline.get("mimeType", inline.get("mime_type"))
            encoded = inline.get("data")
            if mime_type not in {"image/png", "image/jpeg"} or not isinstance(encoded, str):
                continue
            try:
                raw = base64.b64decode(encoded, validate=True)
                with Image.open(io.BytesIO(raw)) as image:
                    image.verify()
            except (binascii.Error, ValueError, OSError, UnidentifiedImageError) as error:
                raise GeminiImageError("Gemini 返回的图片无效") from error
            if not raw:
                raise GeminiImageError("Gemini 返回了空图片")
            return GeneratedImage(raw, mime_type)
    raise GeminiImageError("Gemini 没有返回图片")


def _safe_error_message(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return "服务端未提供错误信息"
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text[:500]
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"][:500]
    return text[:500]


def http_post_json(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as error:
        try:
            error_body = error.read()
        except OSError:
            error_body = b""
        raise GeminiHttpError(
            int(error.code),
            _safe_error_message(error_body),
        ) from error
    except URLError as error:
        raise GeminiImageError(f"Gemini 网络请求失败：{error.reason}") from error
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GeminiImageError("Gemini 响应不是有效 JSON") from error
    if not isinstance(decoded, dict):
        raise GeminiImageError("Gemini JSON 响应顶层不是对象")
    return decoded


def generate_image(
    *,
    api_key: str,
    base_url: str,
    model: str,
    prompt: str,
    references: list[ReferenceImage],
    aspect_ratio: str,
    resolution: str,
    thinking_level: str,
    transport: Transport = http_post_json,
    sleeper: Callable[[float], None] = time.sleep,
    timeout: float = 180.0,
    max_attempts: int = 3,
) -> GeneratedImage:
    encoded_model = quote(model, safe="-.()")
    url = f"{base_url.rstrip('/')}/models/{encoded_model}:generateContent"
    headers = {"Authorization": f"Bearer {api_key}"}
    payload = build_generation_request(
        prompt=prompt,
        references=references,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        thinking_level=thinking_level,
    )
    for attempt in range(1, max_attempts + 1):
        try:
            return extract_image(transport(url, headers, payload, timeout))
        except GeminiHttpError as error:
            retryable = error.status == 429 or error.status >= 500
            if not retryable or attempt == max_attempts:
                raise
        except GeminiImageError:
            if attempt == max_attempts:
                raise
        logger.warning(
            "Gemini 图片请求准备重试 attempt=%s max_attempts=%s model=%s",
            attempt,
            max_attempts,
            model,
        )
        sleeper(float(attempt))
    raise GeminiImageError("Gemini 图片生成失败")
