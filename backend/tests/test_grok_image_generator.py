import base64
import io

from PIL import Image
import pytest

from app.grok_image_generator import (
    GrokHttpError,
    GrokImageError,
    build_generation_request,
    extract_image,
    generate_image,
)
from app.image_generation_types import ReferenceImage


def image_bytes(image_format: str = "JPEG") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (12, 20), "#123456").save(output, format=image_format)
    return output.getvalue()


def test_build_request_uses_string_input_without_references() -> None:
    request = build_generation_request(
        model="grok-4.5",
        prompt="生成一只猫",
        references=[],
        aspect_ratio="9:16",
    )

    assert request == {
        "model": "grok-4.5",
        "input": "最终图片必须为 9:16 画幅。\n\n生成一只猫",
        "tools": [{"type": "image_generation", "action": "auto"}],
        "tool_choice": {"type": "image_generation"},
    }


def test_build_request_uses_multimodal_input_for_references() -> None:
    request = build_generation_request(
        model="grok-4.5",
        prompt="保持人物特征",
        references=[
            ReferenceImage("image/png", b"first"),
            ReferenceImage("image/webp", b"second"),
        ],
        aspect_ratio="Auto",
    )

    assert request["input"] == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "保持人物特征"},
                {
                    "type": "input_image",
                    "image_url": "data:image/png;base64,Zmlyc3Q=",
                },
                {
                    "type": "input_image",
                    "image_url": "data:image/webp;base64,c2Vjb25k",
                },
            ],
        }
    ]


def test_extract_image_reads_completed_image_call() -> None:
    raw = image_bytes()
    encoded = base64.b64encode(raw).decode("ascii")

    generated = extract_image(
        {
            "output": [
                {"type": "reasoning"},
                {
                    "type": "image_generation_call",
                    "status": "completed",
                    "result": encoded,
                },
            ]
        }
    )

    assert generated.data == raw
    assert generated.mime_type == "image/jpeg"


def test_extract_image_recognizes_png_content() -> None:
    raw = image_bytes("PNG")

    generated = extract_image(
        {
            "output": [
                {
                    "type": "image_generation_call",
                    "result": base64.b64encode(raw).decode("ascii"),
                }
            ]
        }
    )

    assert generated.mime_type == "image/png"


@pytest.mark.parametrize(
    "response",
    [
        {},
        {"output": []},
        {"output": [{"type": "message"}]},
        {"output": [{"type": "image_generation_call", "result": "%%%"}]},
        {
            "output": [
                {
                    "type": "image_generation_call",
                    "result": base64.b64encode(b"not-an-image").decode("ascii"),
                }
            ]
        },
    ],
)
def test_extract_image_rejects_invalid_results(response) -> None:
    with pytest.raises(GrokImageError):
        extract_image(response)


def test_generate_image_posts_to_responses_and_retries_5xx() -> None:
    attempts = []
    sleeps = []
    encoded = base64.b64encode(image_bytes("PNG")).decode("ascii")

    def transport(url, headers, payload, timeout):
        attempts.append((url, headers, payload, timeout))
        if len(attempts) == 1:
            raise GrokHttpError(502, "暂时不可用")
        return {
            "output": [
                {"type": "image_generation_call", "result": encoded}
            ]
        }

    generated = generate_image(
        api_key="secret",
        base_url="https://gateway.example/v1/",
        model="grok-4.5",
        prompt="生成图片",
        references=[],
        aspect_ratio="1:1",
        transport=transport,
        sleeper=sleeps.append,
    )

    assert generated.mime_type == "image/png"
    assert len(attempts) == 2
    assert attempts[0][0] == "https://gateway.example/v1/responses"
    assert attempts[0][1] == {"Authorization": "Bearer secret"}
    assert attempts[0][2]["model"] == "grok-4.5"
    assert attempts[0][3] == 120.0
    assert sleeps == [1.0]


def test_generate_image_retries_invalid_response() -> None:
    attempts = 0
    encoded = base64.b64encode(image_bytes()).decode("ascii")

    def transport(url, headers, payload, timeout):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return {"output": []}
        return {
            "output": [
                {"type": "image_generation_call", "result": encoded}
            ]
        }

    generate_image(
        api_key="secret",
        base_url="https://gateway.example/v1",
        model="grok-4.5",
        prompt="生成图片",
        references=[],
        aspect_ratio="Auto",
        transport=transport,
        sleeper=lambda delay: None,
    )

    assert attempts == 2


def test_generate_image_does_not_retry_non_retryable_4xx() -> None:
    attempts = 0

    def transport(url, headers, payload, timeout):
        nonlocal attempts
        attempts += 1
        raise GrokHttpError(403, "禁止访问")

    with pytest.raises(GrokHttpError):
        generate_image(
            api_key="secret",
            base_url="https://gateway.example/v1",
            model="grok-4.5",
            prompt="生成图片",
            references=[],
            aspect_ratio="Auto",
            transport=transport,
            sleeper=lambda delay: None,
        )

    assert attempts == 1
