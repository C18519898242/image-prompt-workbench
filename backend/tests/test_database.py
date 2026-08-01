import sqlite3
from pathlib import Path

import pytest


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


@pytest.fixture
def database(tmp_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(tmp_path / "app.db")
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    yield connection
    connection.close()


def test_schema_creates_expected_tables(database: sqlite3.Connection) -> None:
    tables = {
        row[0]
        for row in database.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }

    assert tables == {
        "prompt_cards",
        "categories",
        "prompt_card_categories",
    }


def test_prompt_cards_contains_expected_columns(
    database: sqlite3.Connection,
) -> None:
    columns = {
        row[1]: (row[2], row[3], row[4])
        for row in database.execute("PRAGMA table_info(prompt_cards)")
    }

    assert columns == {
        "id": ("INTEGER", 0, None),
        "title": ("TEXT", 1, None),
        "prompt_text": ("TEXT", 1, None),
        "example_image_path": ("TEXT", 1, None),
        "sort_order": ("INTEGER", 1, "0"),
        "created_at": ("TEXT", 1, "CURRENT_TIMESTAMP"),
        "updated_at": ("TEXT", 1, "CURRENT_TIMESTAMP"),
    }


def test_categories_name_is_unique(database: sqlite3.Connection) -> None:
    database.execute("INSERT INTO categories (name) VALUES (?)", ("人物",))

    with pytest.raises(sqlite3.IntegrityError):
        database.execute("INSERT INTO categories (name) VALUES (?)", ("人物",))


def test_card_categories_supports_many_to_many_and_cascade_delete(
    database: sqlite3.Connection,
) -> None:
    database.execute(
        "INSERT INTO prompt_cards "
        "(title, prompt_text, example_image_path) VALUES (?, ?, ?)",
        ("卡片", "提示词", "prompt-images/example.png"),
    )
    database.executemany(
        "INSERT INTO categories (name) VALUES (?)",
        [("人物",), ("场景",)],
    )
    database.executemany(
        "INSERT INTO prompt_card_categories "
        "(prompt_card_id, category_id) VALUES (?, ?)",
        [(1, 1), (1, 2)],
    )
    database.commit()

    database.execute("DELETE FROM categories WHERE id = 1")
    remaining = database.execute(
        "SELECT prompt_card_id, category_id "
        "FROM prompt_card_categories"
    ).fetchall()

    assert remaining == [(1, 2)]


def test_category_lookup_index_exists(database: sqlite3.Connection) -> None:
    indexes = {
        row[1]
        for row in database.execute("PRAGMA index_list(prompt_card_categories)")
    }

    assert "idx_prompt_card_categories_category" in indexes
