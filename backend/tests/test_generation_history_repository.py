from pathlib import Path
import sqlite3

import pytest

from app.generation_history_repository import GenerationHistoryRepository

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


@pytest.fixture
def connection(tmp_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(tmp_path / "app.db")
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    yield connection
    connection.close()


@pytest.fixture
def repository(connection: sqlite3.Connection) -> GenerationHistoryRepository:
    return GenerationHistoryRepository(connection)


def _create_card(connection: sqlite3.Connection, title: str) -> int:
    cursor = connection.execute(
        "INSERT INTO prompt_cards "
        "(title, prompt_text, example_image_path) VALUES (?, ?, ?)",
        (title, f"{title}提示词", "prompt-images/example.png"),
    )
    connection.commit()
    return int(cursor.lastrowid)


def test_create_and_get_history_returns_prompt_card_title(
    repository: GenerationHistoryRepository,
    connection: sqlite3.Connection,
) -> None:
    card_id = _create_card(connection, "江南烟雨")

    history_id = repository.create_history(
        prompt_card_id=card_id,
        image_path="generated-images/1754447075.png",
        model="Nano Banana 2",
        aspect_ratio="4:3",
        resolution="1K",
        created_at=1754447075,
    )

    history = repository.get_history(history_id)

    assert history is not None
    assert history.prompt_card_id == card_id
    assert history.prompt_card_title == "江南烟雨"
    assert history.image_path == "generated-images/1754447075.png"
    assert history.created_at == 1754447075


def test_list_histories_orders_newest_first_and_filters_by_card(
    repository: GenerationHistoryRepository,
    connection: sqlite3.Connection,
) -> None:
    first_card_id = _create_card(connection, "第一张卡")
    second_card_id = _create_card(connection, "第二张卡")
    older_id = repository.create_history(
        prompt_card_id=first_card_id,
        image_path="generated-images/1.png",
        model="model",
        aspect_ratio="4:3",
        resolution="1K",
        created_at=100,
    )
    newest_id = repository.create_history(
        prompt_card_id=second_card_id,
        image_path="generated-images/2.png",
        model="model",
        aspect_ratio="1:1",
        resolution="2K",
        created_at=200,
    )

    assert [item.id for item in repository.list_histories()] == [
        newest_id,
        older_id,
    ]
    assert [
        item.prompt_card_id
        for item in repository.list_histories(prompt_card_id=second_card_id)
    ] == [second_card_id]


def test_delete_history_returns_true_once_and_false_afterward(
    repository: GenerationHistoryRepository,
    connection: sqlite3.Connection,
) -> None:
    card_id = _create_card(connection, "待删除卡")
    history_id = repository.create_history(
        prompt_card_id=card_id,
        image_path="generated-images/delete.png",
        model="model",
        aspect_ratio="4:3",
        resolution="1K",
    )

    assert repository.delete_history(history_id) is True
    assert repository.delete_history(history_id) is False
    assert repository.get_history(history_id) is None
