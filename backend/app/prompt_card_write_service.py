from __future__ import annotations

import logging
from pathlib import Path
import tempfile
from uuid import uuid4

from app.prompt_card_images import derive_image_paths
from app.prompt_card_repository import PromptCard, PromptCardRepository
from app.prompt_card_uploads import (
    ImageSelection,
    IncomingImage,
    PromptCardValidationError,
    prepare_final_images,
)


class PromptCardNotFoundError(LookupError):
    pass


class PromptCardWriteService:
    def __init__(
        self,
        repository: PromptCardRepository,
        image_directory: Path,
    ) -> None:
        self._repository = repository
        self._image_directory = image_directory

    @staticmethod
    def _normalize_text(value: str, message: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise PromptCardValidationError("empty_text", message)
        return normalized

    @staticmethod
    def _relative_first_path(prefix: str, extension: str) -> str:
        return f"prompt-images/{prefix}-01{extension}"

    @staticmethod
    def _write_staged(
        directory: Path,
        prefix: str,
        extension: str,
        contents: tuple[bytes, ...],
    ) -> list[Path]:
        directory.mkdir(parents=True, exist_ok=True)
        paths = []
        for index, content in enumerate(contents, start=1):
            path = directory / f"{prefix}-{index:02d}{extension}"
            path.write_bytes(content)
            paths.append(path)
        return paths

    def create_card(
        self,
        *,
        title: str,
        prompt_text: str,
        selections: tuple[ImageSelection, ...],
        uploads: tuple[IncomingImage, ...],
    ) -> PromptCard:
        title = self._normalize_text(title, "请输入标题")
        prompt_text = self._normalize_text(prompt_text, "请输入提示词")
        prepared = prepare_final_images(selections, {}, uploads)
        self._image_directory.mkdir(parents=True, exist_ok=True)
        prefix = uuid4().hex
        final_paths: list[Path] = []
        with tempfile.TemporaryDirectory(
            dir=self._image_directory,
            prefix=".card-",
        ) as temporary:
            staged = self._write_staged(
                Path(temporary),
                prefix,
                prepared.extension,
                prepared.contents,
            )
            try:
                for staged_path in staged:
                    final_path = self._image_directory / staged_path.name
                    staged_path.replace(final_path)
                    final_paths.append(final_path)
                card_id = self._repository.create_prompt_card(
                    title=title,
                    prompt_text=prompt_text,
                    example_image_path=self._relative_first_path(
                        prefix,
                        prepared.extension,
                    ),
                    image_count=len(prepared.contents),
                    sort_order=0,
                    category_ids=(),
                )
            except Exception:
                for path in final_paths:
                    path.unlink(missing_ok=True)
                raise
        card = self._repository.get_prompt_card(card_id)
        if card is None:
            raise RuntimeError("创建卡片后无法读取数据")
        return card

    def _read_existing(self, card: PromptCard) -> dict[int, bytes]:
        paths = derive_image_paths(
            card.example_image_path,
            card.image_count,
            self._image_directory,
        )
        try:
            return {
                index: path.read_bytes()
                for index, path in enumerate(paths, start=1)
            }
        except OSError as error:
            raise PromptCardValidationError(
                "invalid_image",
                "原示例图文件不可用",
            ) from error

    def _restore_backup(self, backup_directory: Path) -> None:
        for backup in backup_directory.iterdir():
            backup.replace(self._image_directory / backup.name)

    def update_card(
        self,
        card_id: int,
        *,
        title: str,
        prompt_text: str,
        selections: tuple[ImageSelection, ...],
        uploads: tuple[IncomingImage, ...],
    ) -> PromptCard:
        card = self._repository.get_prompt_card(card_id)
        if card is None:
            raise PromptCardNotFoundError(card_id)
        title = self._normalize_text(title, "请输入标题")
        prompt_text = self._normalize_text(prompt_text, "请输入提示词")
        prepared = prepare_final_images(
            selections,
            self._read_existing(card),
            uploads,
        )
        old_paths = derive_image_paths(
            card.example_image_path,
            card.image_count,
            self._image_directory,
        )
        prefix = Path(card.example_image_path).stem.rsplit("-", 1)[0]
        new_paths: list[Path] = []
        with tempfile.TemporaryDirectory(
            dir=self._image_directory,
            prefix=".card-",
        ) as temporary:
            temporary_path = Path(temporary)
            staged = self._write_staged(
                temporary_path / "new",
                prefix,
                prepared.extension,
                prepared.contents,
            )
            backup_directory = temporary_path / "backup"
            backup_directory.mkdir(parents=True)
            try:
                for old_path in old_paths:
                    old_path.replace(backup_directory / old_path.name)
                for staged_path in staged:
                    destination = self._image_directory / staged_path.name
                    staged_path.replace(destination)
                    new_paths.append(destination)
                updated = self._repository.update_prompt_card_content(
                    card_id,
                    title=title,
                    prompt_text=prompt_text,
                    example_image_path=self._relative_first_path(
                        prefix,
                        prepared.extension,
                    ),
                    image_count=len(prepared.contents),
                )
                if not updated:
                    raise PromptCardNotFoundError(card_id)
            except Exception:
                for path in new_paths:
                    path.unlink(missing_ok=True)
                self._restore_backup(backup_directory)
                raise
        updated_card = self._repository.get_prompt_card(card_id)
        if updated_card is None:
            raise PromptCardNotFoundError(card_id)
        return updated_card

    def delete_card(self, card_id: int) -> None:
        card = self._repository.get_prompt_card(card_id)
        if card is None:
            raise PromptCardNotFoundError(card_id)
        paths = derive_image_paths(
            card.example_image_path,
            card.image_count,
            self._image_directory,
        )
        if not self._repository.delete_prompt_card(card_id):
            raise PromptCardNotFoundError(card_id)
        for path in paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logging.getLogger("app.prompt_cards").exception(
                    "删除卡片示例图失败: %s",
                    path.name,
                )
