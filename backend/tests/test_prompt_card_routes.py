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
    assert card["example_image_path"] == "prompt-images/0001-01.jpg"
    assert len(card["images"]) == 2
    assert card["images"] == [
        {
            "index": 1,
            "path": "prompt-images/0001-01.jpg",
            "url": "/media/prompt-images/0001-01.jpg",
        },
        {
            "index": 2,
            "path": "prompt-images/0001-02.jpg",
            "url": "/media/prompt-images/0001-02.jpg",
        },
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


def test_list_categories_requires_auth(prompt_card_client: TestClient) -> None:
    response = prompt_card_client.get("/api/categories")
    assert response.status_code == 401


def test_list_categories_returns_items(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    settings = prompt_card_client.app.state.settings
    connection = sqlite3.connect(settings.database_path)
    repository = PromptCardRepository(connection)
    category_id = repository.create_category("风景", sort_order=1)
    connection.close()

    response = prompt_card_client.get(
        "/api/categories",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert any(
        item["id"] == category_id and item["name"] == "风景" for item in body["items"]
    )


def test_list_prompt_cards_includes_categories(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    settings = prompt_card_client.app.state.settings
    connection = sqlite3.connect(settings.database_path)
    repository = PromptCardRepository(connection)
    category_id = repository.create_category("科技", sort_order=0)
    card_id = repository.create_prompt_card(
        title="测试卡",
        prompt_text="提示词",
        example_image_path="prompt-images/0001-01.jpg",
        category_ids=[category_id],
    )
    connection.close()

    response = prompt_card_client.get(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    item = next(card for card in response.json()["items"] if card["id"] == card_id)
    assert item["categories"][0]["name"] == "科技"
    assert category_id in item["category_ids"]
