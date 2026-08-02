import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.config import Settings
from app.main import create_app
from app.prompt_card_repository import PromptCardRepository

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


@pytest.fixture
def password() -> str:
    return "route-test-password"


@pytest.fixture
def prompt_card_client(password: str, tmp_path: Path) -> TestClient:
    database_path = tmp_path / "app.db"
    image_directory = tmp_path / "prompt-images"
    image_directory.mkdir()

    connection = sqlite3.connect(database_path)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    repository = PromptCardRepository(connection)
    repository.create_prompt_card(
        title="多图卡片",
        prompt_text="完整提示词",
        example_image_path="prompt-images/0001-01.jpg",
        sort_order=1,
        image_count=2,
    )
    connection.close()

    (image_directory / "0001-01.jpg").write_bytes(b"jpg-one")
    (image_directory / "0001-02.jpg").write_bytes(b"jpg-two")

    settings = Settings(
        auth_password_hash=hash_password(password),
        database_path=database_path,
        image_directory=image_directory,
    )
    return TestClient(create_app(settings))


def _login(client: TestClient, password: str) -> str:
    response = client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 200
    return response.json()["token"]


def test_list_prompt_cards_requires_token(prompt_card_client: TestClient) -> None:
    response = prompt_card_client.get("/api/prompt-cards")
    assert response.status_code == 401


def test_list_prompt_cards_returns_images(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)

    response = prompt_card_client.get(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 1
    card = payload["items"][0]
    assert card["image_count"] == 2
    assert len(card["images"]) == 2
    assert card["images"] == [
        {"index": 1, "url": "/api/prompt-cards/1/images/1"},
        {"index": 2, "url": "/api/prompt-cards/1/images/2"},
    ]


def test_get_prompt_card_image_returns_file(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)

    response = prompt_card_client.get(
        "/api/prompt-cards/1/images/2",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.content == b"jpg-two"


def test_get_prompt_card_image_out_of_range_returns_404(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)

    response = prompt_card_client.get(
        "/api/prompt-cards/1/images/3",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404


def test_get_prompt_card_image_requires_token(
    prompt_card_client: TestClient,
) -> None:
    response = prompt_card_client.get("/api/prompt-cards/1/images/1")
    assert response.status_code == 401
