import io
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.auth import hash_password
from app.config import Settings
from app.gemini_image_generator import GeneratedImage, GeminiImageError
from app.main import create_app
from app.prompt_card_repository import PromptCardRepository

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


@pytest.fixture
def password() -> str:
    return "generation-route-password"


@pytest.fixture
def png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "#123456").save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def generation_client(password: str, tmp_path: Path) -> TestClient:
    data_root = tmp_path / "data"
    data_root.mkdir()
    image_directory = data_root / "prompt-images"
    image_directory.mkdir()
    database_path = data_root / "app.db"
    connection = sqlite3.connect(database_path)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    PromptCardRepository(connection).create_prompt_card(
        title="测试卡",
        prompt_text="测试提示词",
        example_image_path="prompt-images/example.png",
    )
    connection.close()
    settings = Settings(
        auth_password_hash=hash_password(password),
        database_path=database_path,
        image_directory=image_directory,
        gemini_api_key="secret",
    )
    return TestClient(create_app(settings))


def login(client: TestClient, password: str) -> str:
    response = client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 200
    return response.json()["token"]


def test_create_generation_writes_image_and_history(generation_client, password, png_bytes):
    captured = {}

    def fake_generator(**kwargs):
        captured.update(kwargs)
        return GeneratedImage(png_bytes, "image/png")

    generation_client.app.state.image_generator = fake_generator
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "prompt_card_id": "1",
            "prompt": "生成雨夜城市",
            "model": "Nano Banana 2",
            "aspect_ratio": "16:9",
            "resolution": "2K",
            "thinking_level": "high",
        },
        files=[
            ("reference_images", ("ref.png", png_bytes, "image/png")),
        ],
    )

    assert response.status_code == 201
    body = response.json()
    assert body["prompt_card_id"] == 1
    assert body["model"] == "Nano Banana 2"
    assert body["aspect_ratio"] == "16:9"
    assert body["resolution"] == "2K"
    assert body["image_path"].startswith("generated-images/")
    assert generation_client.app.state.generated_image_directory.joinpath(
        Path(body["image_path"]).name
    ).is_file()
    assert captured["prompt"] == "生成雨夜城市"
    assert captured["references"][0].mime_type == "image/png"
    assert captured["thinking_level"] == "high"

    listed = generation_client.get(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert [item["id"] for item in listed.json()["items"]] == [body["id"]]


def generation_form(prompt_card_id: str = "1") -> dict[str, str]:
    return {
        "prompt_card_id": prompt_card_id,
        "prompt": "生成图片",
        "model": "Nano Banana 2",
        "aspect_ratio": "Auto",
        "resolution": "1K",
        "thinking_level": "minimal",
    }


def test_generation_requires_login(generation_client) -> None:
    assert generation_client.post(
        "/api/generations",
        data=generation_form(),
    ).status_code == 401


def test_generation_requires_api_key(generation_client, password) -> None:
    generation_client.app.state.settings.gemini_api_key = ""
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data=generation_form(),
    )
    assert response.status_code == 503


def test_generation_rejects_more_than_eight_references(
    generation_client, password, png_bytes
) -> None:
    token = login(generation_client, password)
    files = [
        ("reference_images", (f"ref-{index}.png", png_bytes, "image/png"))
        for index in range(9)
    ]
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data=generation_form(),
        files=files,
    )
    assert response.status_code == 422


def test_generation_rejects_missing_prompt_card(
    generation_client, password
) -> None:
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data=generation_form("999"),
    )
    assert response.status_code == 404


def test_generation_failure_writes_log_without_history(generation_client, password):
    def failing_generator(**kwargs):
        raise GeminiImageError("上游没有返回图片")

    generation_client.app.state.image_generator = failing_generator
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "prompt_card_id": "1",
            "prompt": "失败请求",
            "model": "Nano Banana 2",
            "aspect_ratio": "Auto",
            "resolution": "1K",
            "thinking_level": "minimal",
        },
    )

    assert response.status_code == 502
    listed = generation_client.get(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listed.json() == {"items": []}
    # 读取日志前刷新 handler，确保异常已落盘
    import logging

    log_path = generation_client.app.state.generation_log_path
    for handler in logging.getLogger("app.generation").handlers:
        if getattr(handler, "generation_log_path", None) == str(log_path.resolve()):
            handler.flush()
    log_text = log_path.read_text(encoding="utf-8")
    assert "prompt_card_id=1" in log_text
    assert "上游没有返回图片" in log_text
    assert "secret" not in log_text
