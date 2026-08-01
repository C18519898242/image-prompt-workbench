from collections.abc import Iterable
from dataclasses import dataclass
import sqlite3


@dataclass(frozen=True)
class PromptCard:
    id: int
    title: str
    prompt_text: str
    example_image_path: str
    sort_order: int
    created_at: str
    updated_at: str
    category_ids: tuple[int, ...]


@dataclass(frozen=True)
class Category:
    id: int
    name: str
    sort_order: int


class PromptCardRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA foreign_keys = ON")

    def create_prompt_card(
        self,
        *,
        title: str,
        prompt_text: str,
        example_image_path: str,
        sort_order: int = 0,
        category_ids: Iterable[int] = (),
    ) -> int:
        normalized_category_ids = self._normalize_category_ids(category_ids)
        with self._connection:
            cursor = self._connection.execute(
                "INSERT INTO prompt_cards "
                "(title, prompt_text, example_image_path, sort_order) "
                "VALUES (?, ?, ?, ?)",
                (title, prompt_text, example_image_path, sort_order),
            )
            card_id = int(cursor.lastrowid)
            self._replace_category_links(card_id, normalized_category_ids)
        return card_id

    def get_prompt_card(self, card_id: int) -> PromptCard | None:
        row = self._connection.execute(
            "SELECT id, title, prompt_text, example_image_path, sort_order, "
            "created_at, updated_at "
            "FROM prompt_cards WHERE id = ?",
            (card_id,),
        ).fetchone()
        return self._to_prompt_card(row) if row is not None else None

    def list_prompt_cards(self, category_id: int | None = None) -> list[PromptCard]:
        query = (
            "SELECT id, title, prompt_text, example_image_path, sort_order, "
            "created_at, updated_at FROM prompt_cards"
        )
        parameters: tuple[int, ...] = ()
        if category_id is not None:
            query += (
                " WHERE EXISTS ("
                "SELECT 1 FROM prompt_card_categories "
                "WHERE prompt_card_id = prompt_cards.id AND category_id = ?"
                ")"
            )
            parameters = (category_id,)
        query += " ORDER BY sort_order ASC, id ASC"

        rows = self._connection.execute(query, parameters).fetchall()
        return [self._to_prompt_card(row) for row in rows]

    def update_prompt_card(
        self,
        card_id: int,
        *,
        title: str,
        prompt_text: str,
        example_image_path: str,
        sort_order: int,
        category_ids: Iterable[int] = (),
    ) -> bool:
        normalized_category_ids = self._normalize_category_ids(category_ids)
        with self._connection:
            cursor = self._connection.execute(
                "UPDATE prompt_cards SET "
                "title = ?, prompt_text = ?, example_image_path = ?, "
                "sort_order = ?, updated_at = CURRENT_TIMESTAMP "
                "WHERE id = ?",
                (
                    title,
                    prompt_text,
                    example_image_path,
                    sort_order,
                    card_id,
                ),
            )
            if cursor.rowcount == 0:
                return False
            self._replace_category_links(card_id, normalized_category_ids)
        return True

    def delete_prompt_card(self, card_id: int) -> bool:
        with self._connection:
            cursor = self._connection.execute(
                "DELETE FROM prompt_cards WHERE id = ?",
                (card_id,),
            )
        return cursor.rowcount > 0

    def create_category(self, name: str, sort_order: int = 0) -> int:
        with self._connection:
            cursor = self._connection.execute(
                "INSERT INTO categories (name, sort_order) VALUES (?, ?)",
                (name, sort_order),
            )
        return int(cursor.lastrowid)

    def get_category(self, category_id: int) -> Category | None:
        row = self._connection.execute(
            "SELECT id, name, sort_order FROM categories WHERE id = ?",
            (category_id,),
        ).fetchone()
        return self._to_category(row) if row is not None else None

    def list_categories(self) -> list[Category]:
        rows = self._connection.execute(
            "SELECT id, name, sort_order FROM categories "
            "ORDER BY sort_order ASC, id ASC"
        ).fetchall()
        return [self._to_category(row) for row in rows]

    def update_category(
        self,
        category_id: int,
        *,
        name: str,
        sort_order: int,
    ) -> bool:
        with self._connection:
            cursor = self._connection.execute(
                "UPDATE categories SET name = ?, sort_order = ? "
                "WHERE id = ?",
                (name, sort_order, category_id),
            )
        return cursor.rowcount > 0

    def delete_category(self, category_id: int) -> bool:
        with self._connection:
            cursor = self._connection.execute(
                "DELETE FROM categories WHERE id = ?",
                (category_id,),
            )
        return cursor.rowcount > 0

    def _replace_category_links(
        self,
        card_id: int,
        category_ids: tuple[int, ...],
    ) -> None:
        self._connection.execute(
            "DELETE FROM prompt_card_categories WHERE prompt_card_id = ?",
            (card_id,),
        )
        self._connection.executemany(
            "INSERT INTO prompt_card_categories "
            "(prompt_card_id, category_id) VALUES (?, ?)",
            [(card_id, category_id) for category_id in category_ids],
        )

    def _normalize_category_ids(
        self,
        category_ids: Iterable[int],
    ) -> tuple[int, ...]:
        return tuple(dict.fromkeys(int(category_id) for category_id in category_ids))

    def _to_prompt_card(self, row: sqlite3.Row) -> PromptCard:
        category_rows = self._connection.execute(
            "SELECT category_id FROM prompt_card_categories "
            "WHERE prompt_card_id = ? ORDER BY category_id ASC",
            (row["id"],),
        ).fetchall()
        return PromptCard(
            id=row["id"],
            title=row["title"],
            prompt_text=row["prompt_text"],
            example_image_path=row["example_image_path"],
            sort_order=row["sort_order"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            category_ids=tuple(category_row["category_id"] for category_row in category_rows),
        )

    @staticmethod
    def _to_category(row: sqlite3.Row) -> Category:
        return Category(
            id=row["id"],
            name=row["name"],
            sort_order=row["sort_order"],
        )
