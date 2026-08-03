import base64
import io

from PIL import Image
import pytest

from app.gemini_image_generator import (
    GeneratedImage,
    GeminiImageError,
    ReferenceImage,
    build_generation_request,
    extract_image,
)


def png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "#123456").save(output, format="PNG")
    return output.getvalue()


def image_response(raw: bytes, mime_type: str = "image/png") -> dict:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": base64.b64encode(raw).decode("ascii"),
                            }
                        }
                    ]
                }
            }
        ]
    }


def test_build_generation_request_maps_parameters_and_references() -> None:
    request = build_generation_request(
        prompt="画一座雨夜城市",
        references=[ReferenceImage("image/png", b"reference")],
        aspect_ratio="16:9",
        resolution="2K",
        thinking_level="high",
    )

    parts = request["contents"][0]["parts"]
    assert parts[0] == {"text": "画一座雨夜城市"}
    assert parts[1]["inlineData"]["mimeType"] == "image/png"
    assert base64.b64decode(parts[1]["inlineData"]["data"]) == b"reference"
    assert request["generationConfig"] == {
        "responseModalities": ["IMAGE"],
        "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"},
        "thinkingConfig": {"thinkingLevel": "high"},
    }


def test_build_generation_request_omits_auto_aspect_ratio() -> None:
    request = build_generation_request(
        prompt="自由构图",
        references=[],
        aspect_ratio="Auto",
        resolution="1K",
        thinking_level="minimal",
    )

    assert request["generationConfig"]["imageConfig"] == {"imageSize": "1K"}


def test_extract_image_accepts_png_and_rejects_invalid_data() -> None:
    raw = png_bytes()
    assert extract_image(image_response(raw)) == GeneratedImage(raw, "image/png")

    with pytest.raises(GeminiImageError, match="图片"):
        extract_image(image_response(b"not-an-image"))


from app.gemini_image_generator import GeminiHttpError, generate_image


def test_generate_image_builds_native_url_and_bearer_header() -> None:
    calls = []

    def transport(url, headers, payload, timeout):
        calls.append((url, headers, payload, timeout))
        return image_response(png_bytes())

    result = generate_image(
        api_key="secret",
        base_url="https://example.test/v1beta/",
        model="gemini-3.1-flash-image",
        prompt="生成图片",
        references=[],
        aspect_ratio="Auto",
        resolution="1K",
        thinking_level="minimal",
        transport=transport,
        sleeper=lambda _: None,
    )

    assert result.mime_type == "image/png"
    assert calls[0][0] == (
        "https://example.test/v1beta/models/"
        "gemini-3.1-flash-image:generateContent"
    )
    assert calls[0][1]["Authorization"] == "Bearer secret"


@pytest.mark.parametrize(
    "first_failure",
    [
        GeminiHttpError(429, "busy"),
        GeminiHttpError(503, "unavailable"),
        image_response(b"invalid"),
    ],
)
def test_generate_image_retries_retryable_failures(first_failure, caplog) -> None:
    attempts = []
    sleeps = []

    def transport(url, headers, payload, timeout):
        attempts.append(url)
        if len(attempts) == 1:
            if isinstance(first_failure, Exception):
                raise first_failure
            return first_failure
        return image_response(png_bytes())

    with caplog.at_level("WARNING", logger="app.generation"):
        generate_image(
            api_key="secret",
            base_url="https://example.test/v1beta",
            model="gemini-3.1-flash-image",
            prompt="生成图片",
            references=[],
            aspect_ratio="1:1",
            resolution="1K",
            thinking_level="high",
            transport=transport,
            sleeper=sleeps.append,
        )

    assert len(attempts) == 2
    assert sleeps == [1.0]
    assert "attempt=1" in caplog.text


def test_generate_image_does_not_retry_non_retryable_4xx() -> None:
    attempts = []

    def transport(url, headers, payload, timeout):
        attempts.append(url)
        raise GeminiHttpError(401, "bad key")

    with pytest.raises(GeminiHttpError):
        generate_image(
            api_key="secret",
            base_url="https://example.test/v1beta",
            model="gemini-3.1-flash-image",
            prompt="生成图片",
            references=[],
            aspect_ratio="1:1",
            resolution="1K",
            thinking_level="minimal",
            transport=transport,
            sleeper=lambda _: pytest.fail("401 不应等待重试"),
        )

    assert len(attempts) == 1
