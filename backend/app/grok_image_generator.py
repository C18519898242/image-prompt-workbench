from __future__ import annotations

import base64
import binascii
import io
import json
import logging
import time
from typing import Any, Callable, TypeAlias
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image, UnidentifiedImageError

from app.image_generation_types import (
    GeneratedImage,
    ImageGenerationError,
    ReferenceImage,
)

logger = logging.getLogger("app.generation")


class GrokImageError(ImageGenerationError):
    """Grok 图片请求或响应无效。"""


class GrokHttpError(GrokImageError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


Transport: TypeAlias = Callable[
    [str, dict[str, str], dict[str, Any], float],
    dict[str, Any],
]


def _prompt_with_ratio(prompt: str, aspect_ratio: str) -> str:
    if aspect_ratio == "Auto":
        return prompt
    return f"最终图片必须为 {aspect_ratio} 画幅。\n\n{prompt}"


def build_generation_request(
    *,
    model: str,
    prompt: str,
    references: list[ReferenceImage],
    aspect_ratio: str,
) -> dict[str, Any]:
    final_prompt = _prompt_with_ratio(prompt, aspect_ratio)
    input_value: str | list[dict[str, Any]] = final_prompt
    if references:
        content: list[dict[str, str]] = [
            {"type": "input_text", "text": final_prompt}
        ]
        content.extend(
            {
                "type": "input_image",
                "image_url": (
                    f"data:{reference.mime_type};base64,"
                    f"{base64.b64encode(reference.data).decode('ascii')}"
                ),
            }
            for reference in references
        )
        input_value = [{"role": "user", "content": content}]
    return {
        "model": model,
        "input": input_value,
        "tools": [{"type": "image_generation", "action": "auto"}],
        "tool_choice": {"type": "image_generation"},
    }


def extract_image(response: dict[str, Any]) -> GeneratedImage:
    output = response.get("output")
    if not isinstance(output, list):
        raise GrokImageError("Grok 没有返回图片")
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "image_generation_call":
            continue
        encoded = item.get("result")
        if not isinstance(encoded, str) or not encoded:
            continue
        try:
            raw = base64.b64decode(encoded, validate=True)
            with Image.open(io.BytesIO(raw)) as image:
                image_format = image.format
                image.verify()
        except (binascii.Error, ValueError, OSError, UnidentifiedImageError) as error:
            raise GrokImageError("Grok 返回的图片无效") from error
        mime_type = {"JPEG": "image/jpeg", "PNG": "image/png"}.get(image_format)
        if mime_type is None:
            raise GrokImageError("Grok 返回了不支持的图片格式")
        return GeneratedImage(raw, mime_type)
    raise GrokImageError("Grok 没有返回图片")


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
        raise GrokHttpError(
            int(error.code),
            _safe_error_message(error_body),
        ) from error
    except URLError as error:
        raise GrokImageError(f"Grok 网络请求失败：{error.reason}") from error
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GrokImageError("Grok 响应不是有效 JSON") from error
    if not isinstance(decoded, dict):
        raise GrokImageError("Grok JSON 响应顶层不是对象")
    return decoded


def generate_image(
    *,
    api_key: str,
    base_url: str,
    model: str,
    prompt: str,
    references: list[ReferenceImage],
    aspect_ratio: str,
    transport: Transport = http_post_json,
    sleeper: Callable[[float], None] = time.sleep,
    timeout: float = 120.0,
    max_attempts: int = 3,
) -> GeneratedImage:
    url = f"{base_url.rstrip('/')}/responses"
    headers = {"Authorization": f"Bearer {api_key}"}
    payload = build_generation_request(
        model=model,
        prompt=prompt,
        references=references,
        aspect_ratio=aspect_ratio,
    )
    for attempt in range(1, max_attempts + 1):
        try:
            return extract_image(transport(url, headers, payload, timeout))
        except GrokHttpError as error:
            retryable = error.status == 429 or error.status >= 500
            if not retryable or attempt == max_attempts:
                raise
        except GrokImageError:
            if attempt == max_attempts:
                raise
        logger.warning(
            "Grok 图片请求准备重试 attempt=%s max_attempts=%s model=%s",
            attempt,
            max_attempts,
            model,
        )
        sleeper(float(attempt))
    raise GrokImageError("Grok 图片生成失败")
