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
    PreparedImages,
    PromptCardValidationError,
    prepare_final_images,
    stage_prepared_images,
)

LOGGER = logging.getLogger("app.prompt_cards")


class PromptCardNotFoundError(LookupError):
    def __init__(self, card_id: int) -> None:
        self.card_id = card_id
        super().__init__(f"提示词卡片不存在：{card_id}")


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
        prepared: PreparedImages,
    ) -> list[Path]:
        return stage_prepared_images(prepared, directory, prefix)

    def _discard_visible_paths(
        self,
        paths: list[Path],
        *,
        failure_message: str,
        recovery_root: Path | None = None,
    ) -> Path:
        recovery_root = recovery_root or (
            self._image_directory / f".recovery-{uuid4().hex}"
        )
        discard_directory = recovery_root / "discard"
        try:
            discard_directory.mkdir(parents=True, exist_ok=True)
        except OSError:
            LOGGER.exception("创建图片恢复目录失败: %s", recovery_root)
            self._unlink_independently(paths, failure_message=failure_message)
            return recovery_root

        isolated: list[Path] = []
        for path in paths:
            if not path.exists():
                continue
            destination = discard_directory / path.name
            try:
                path.replace(destination)
                isolated.append(destination)
            except OSError:
                LOGGER.exception("隔离待回收卡片图片失败: %s", path)
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    LOGGER.exception(
                        "%s，正式路径仍有残留，需人工处理: %s",
                        failure_message,
                        path,
                    )
        self._unlink_independently(isolated, failure_message=failure_message)
        self._remove_empty_recovery(recovery_root)
        return recovery_root

    @staticmethod
    def _unlink_independently(
        paths: list[Path],
        *,
        failure_message: str,
    ) -> None:
        for path in paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                LOGGER.exception("%s，文件保留在: %s", failure_message, path)

    @staticmethod
    def _remove_empty_recovery(recovery_root: Path) -> None:
        discard_directory = recovery_root / "discard"
        for directory in (discard_directory, recovery_root / "backup", recovery_root):
            try:
                directory.rmdir()
            except OSError:
                pass

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
                prepared,
            )
            try:
                for staged_path in staged:
                    final_path = self._image_directory / staged_path.name
                    staged_path.replace(final_path)
                    final_paths.append(final_path)
                card = self._repository.create_prompt_card_with_result(
                    title=title,
                    prompt_text=prompt_text,
                    example_image_path=self._relative_first_path(
                        prefix,
                        prepared.extension,
                    ),
                    image_count=prepared.image_count,
                    sort_order=0,
                    category_ids=(),
                )
            except Exception:
                self._discard_visible_paths(
                    final_paths,
                    failure_message="回收新建卡片图片失败",
                )
                raise
        return card

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
        old_paths = derive_image_paths(
            card.example_image_path,
            card.image_count,
            self._image_directory,
        )
        prepared = prepare_final_images(
            selections,
            {
                index: path
                for index, path in enumerate(old_paths, start=1)
            },
            uploads,
        )
        prefix = uuid4().hex
        new_paths: list[Path] = []
        with tempfile.TemporaryDirectory(
            dir=self._image_directory,
            prefix=".card-",
        ) as temporary:
            temporary_path = Path(temporary)
            staged = self._write_staged(
                temporary_path / "new",
                prefix,
                prepared,
            )
            try:
                for staged_path in staged:
                    destination = self._image_directory / staged_path.name
                    staged_path.replace(destination)
                    new_paths.append(destination)
                updated_card = self._repository.update_prompt_card_content_with_result(
                    card_id,
                    title=title,
                    prompt_text=prompt_text,
                    example_image_path=self._relative_first_path(
                        prefix,
                        prepared.extension,
                    ),
                    image_count=prepared.image_count,
                )
                if updated_card is None:
                    raise PromptCardNotFoundError(card_id)
            except Exception:
                self._discard_visible_paths(
                    new_paths,
                    failure_message="回收更新后的卡片图片失败",
                )
                raise
        self._unlink_independently(
            old_paths,
            failure_message="清理已替换的卡片原图失败",
        )
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
