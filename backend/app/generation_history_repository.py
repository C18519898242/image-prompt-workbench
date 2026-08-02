from dataclasses import dataclass
import sqlite3
import time


@dataclass(frozen=True)
class GenerationHistory:
    id: int
    prompt_card_id: int
    prompt_card_title: str
    image_path: str
    model: str
    aspect_ratio: str
    resolution: str
    created_at: int


class GenerationHistoryRepository:
    _SELECT = (
        "SELECT h.id, h.prompt_card_id, p.title AS prompt_card_title, "
        "h.image_path, h.model, h.aspect_ratio, h.resolution, h.created_at "
        "FROM generation_history AS h "
        "JOIN prompt_cards AS p ON p.id = h.prompt_card_id"
    )

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA foreign_keys = ON")

    def create_history(
        self,
        *,
        prompt_card_id: int,
        image_path: str,
        model: str,
        aspect_ratio: str,
        resolution: str,
        created_at: int | None = None,
    ) -> int:
        timestamp = int(time.time()) if created_at is None else int(created_at)
        with self._connection:
            cursor = self._connection.execute(
                "INSERT INTO generation_history "
                "(prompt_card_id, image_path, model, aspect_ratio, resolution, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    prompt_card_id,
                    image_path,
                    model,
                    aspect_ratio,
                    resolution,
                    timestamp,
                ),
            )
        return int(cursor.lastrowid)

    def get_history(self, history_id: int) -> GenerationHistory | None:
        row = self._connection.execute(
            f"{self._SELECT} WHERE h.id = ?",
            (history_id,),
        ).fetchone()
        return self._to_history(row) if row is not None else None

    def list_histories(
        self,
        prompt_card_id: int | None = None,
    ) -> list[GenerationHistory]:
        query = self._SELECT
        parameters: tuple[int, ...] = ()
        if prompt_card_id is not None:
            query += " WHERE h.prompt_card_id = ?"
            parameters = (prompt_card_id,)
        query += " ORDER BY h.created_at DESC, h.id DESC"
        rows = self._connection.execute(query, parameters).fetchall()
        return [self._to_history(row) for row in rows]

    def delete_history(self, history_id: int) -> bool:
        with self._connection:
            cursor = self._connection.execute(
                "DELETE FROM generation_history WHERE id = ?",
                (history_id,),
            )
        return cursor.rowcount > 0

    @staticmethod
    def _to_history(row: sqlite3.Row) -> GenerationHistory:
        return GenerationHistory(
            id=row["id"],
            prompt_card_id=row["prompt_card_id"],
            prompt_card_title=row["prompt_card_title"],
            image_path=row["image_path"],
            model=row["model"],
            aspect_ratio=row["aspect_ratio"],
            resolution=row["resolution"],
            created_at=row["created_at"],
        )
