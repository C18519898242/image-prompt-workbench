from pathlib import Path
import sqlite3

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
def history_client(password: str, tmp_path: Path) -> TestClient:
    data_root = tmp_path / "data"
    data_root.mkdir()
    generated_image_directory = data_root / "generated-images"
    generated_image_directory.mkdir()
    image_directory = data_root / "prompt-images"
    image_directory.mkdir()
    database_path = data_root / "app.db"

    connection = sqlite3.connect(database_path)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    prompt_cards = PromptCardRepository(connection)
    prompt_cards.create_prompt_card(
        title="测试卡",
        prompt_text="测试提示词",
        example_image_path="prompt-images/example.png",
    )
    prompt_cards.create_prompt_card(
        title="第二张卡",
        prompt_text="第二个提示词",
        example_image_path="prompt-images/example-2.png",
    )
    connection.close()

    settings = Settings(
        auth_password_hash=hash_password(password),
        database_path=database_path,
        image_directory=image_directory,
    )
    application = create_app(settings)
    application.state.generated_image_directory = generated_image_directory
    return TestClient(application)


def _login(client: TestClient, password: str) -> str:
    response = client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 200
    return response.json()["token"]


def _create_history_via_api(
    client: TestClient,
    token: str,
    prompt_card_id: int,
    filename: str,
) -> int:
    response = client.post(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "prompt_card_id": prompt_card_id,
            "image_path": f"generated-images/{filename}",
            "model": "Nano Banana 2",
            "aspect_ratio": "4:3",
            "resolution": "1K",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_history_routes_require_token(history_client: TestClient) -> None:
    assert history_client.get("/api/generation-history").status_code == 401
    assert (
        history_client.post(
            "/api/generation-history",
            json={
                "prompt_card_id": 1,
                "image_path": "generated-images/one.png",
                "model": "model",
                "aspect_ratio": "4:3",
                "resolution": "1K",
            },
        ).status_code
        == 401
    )
    assert history_client.get("/api/generation-history/1").status_code == 401
    assert history_client.delete("/api/generation-history/1").status_code == 401


def test_create_history_returns_computed_title_and_url(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)
    history_client.app.state.generated_image_directory.joinpath(
        "one.png"
    ).write_bytes(b"generated")

    response = history_client.post(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "prompt_card_id": 1,
            "image_path": "generated-images/one.png",
            "model": "Nano Banana 2",
            "aspect_ratio": "4:3",
            "resolution": "1K",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["prompt_card_id"] == 1
    assert body["title"].startswith("测试卡 ")
    assert body["image_path"] == "generated-images/one.png"
    assert body["url"] == "/media/generated-images/one.png"
    assert isinstance(body["created_at"], int)


def test_list_history_can_filter_by_prompt_card(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)
    for filename in ("one.png", "two.png"):
        history_client.app.state.generated_image_directory.joinpath(
            filename
        ).write_bytes(filename.encode())
    _create_history_via_api(history_client, token, 1, "one.png")
    _create_history_via_api(history_client, token, 2, "two.png")

    response = history_client.get(
        "/api/generation-history?prompt_card_id=1",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert [item["prompt_card_id"] for item in response.json()["items"]] == [1]


def test_get_missing_history_returns_404(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)

    response = history_client.get(
        "/api/generation-history/999",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404


def test_delete_history_removes_record_and_image(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)
    image_path = history_client.app.state.generated_image_directory / "delete.png"
    image_path.write_bytes(b"generated")
    history_id = _create_history_via_api(
        history_client,
        token,
        prompt_card_id=1,
        filename="delete.png",
    )

    response = history_client.delete(
        f"/api/generation-history/{history_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    assert not image_path.exists()
    assert (
        history_client.get(
            f"/api/generation-history/{history_id}",
            headers={"Authorization": f"Bearer {token}"},
        ).status_code
        == 404
    )


def test_create_history_missing_prompt_card_returns_404(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)
    history_client.app.state.generated_image_directory.joinpath(
        "missing-card.png"
    ).write_bytes(b"generated")

    response = history_client.post(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "prompt_card_id": 999,
            "image_path": "generated-images/missing-card.png",
            "model": "Nano Banana 2",
            "aspect_ratio": "4:3",
            "resolution": "1K",
        },
    )

    assert response.status_code == 404


def test_create_history_rejects_invalid_image_paths(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)
    headers = {"Authorization": f"Bearer {token}"}
    invalid_paths = [
        "/absolute/generated-images/one.png",
        "generated-images/../secret.png",
        "prompt-images/one.png",
        "generated-images/missing.png",
    ]

    for image_path in invalid_paths:
        response = history_client.post(
            "/api/generation-history",
            headers=headers,
            json={
                "prompt_card_id": 1,
                "image_path": image_path,
                "model": "Nano Banana 2",
                "aspect_ratio": "4:3",
                "resolution": "1K",
            },
        )
        assert response.status_code == 422, image_path
