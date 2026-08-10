from io import BytesIO
import sqlite3
from pathlib import Path

import pytest
from PIL import Image

from app.prompt_card_images import derive_image_paths
from app.prompt_card_repository import PromptCardInUseError, PromptCardRepository
from app.prompt_card_uploads import ExistingSelection, IncomingImage, UploadSelection
from app.prompt_card_write_service import PromptCardNotFoundError, PromptCardWriteService


def image_bytes(format_name: str, color=(255, 0, 0, 255)) -> bytes:
    output = BytesIO()
    mode = "RGBA" if format_name == "PNG" else "RGB"
    image = Image.new(mode, (4, 4), color if mode == "RGBA" else color[:3])
    image.save(output, format=format_name)
    return output.getvalue()


@pytest.fixture
def service_context(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "app.db")
    schema = Path(__file__).resolve().parents[1] / "schema.sql"
    connection.executescript(schema.read_text(encoding="utf-8"))
    image_directory = tmp_path / "prompt-images"
    image_directory.mkdir()
    repository = PromptCardRepository(connection)
    service = PromptCardWriteService(repository, image_directory)
    yield service, repository, image_directory
    connection.close()


def test_create_card_writes_numbered_images_and_empty_categories(service_context):
    service, repository, image_directory = service_context
    card = service.create_card(
        title=" 新卡片 ",
        prompt_text=" 新提示词 ",
        selections=(UploadSelection(0), UploadSelection(1)),
        uploads=(
            IncomingImage("one.jpg", image_bytes("JPEG")),
            IncomingImage("two.jpg", image_bytes("JPEG")),
        ),
    )
    assert card.title == "新卡片"
    assert card.prompt_text == "新提示词"
    assert card.category_ids == ()
    assert card.image_count == 2
    assert (image_directory / Path(card.example_image_path).name).is_file()
    assert len(list(image_directory.glob("*.jpg"))) == 2
    assert repository.get_prompt_card(card.id) == card


def test_create_card_database_failure_removes_written_images(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context

    def fail_create(**kwargs):
        raise RuntimeError("db failed")

    monkeypatch.setattr(repository, "create_prompt_card", fail_create)

    with pytest.raises(RuntimeError, match="db failed"):
        service.create_card(
            title="标题",
            prompt_text="提示词",
            selections=(UploadSelection(0),),
            uploads=(IncomingImage("new.jpg", image_bytes("JPEG")),),
        )
    assert list(image_directory.iterdir()) == []


def test_update_card_reorders_existing_and_upload_and_preserves_metadata(
    service_context,
):
    service, repository, image_directory = service_context
    category_id = repository.create_category("保留分类")
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/original-01.jpg",
        image_count=2,
        sort_order=9,
        category_ids=[category_id],
    )
    first = image_bytes("JPEG")
    second = image_bytes("JPEG", (0, 255, 0, 255))
    (image_directory / "original-01.jpg").write_bytes(first)
    (image_directory / "original-02.jpg").write_bytes(second)

    card = service.update_card(
        card_id,
        title="新标题",
        prompt_text="新提示词",
        selections=(
            ExistingSelection(2),
            UploadSelection(0),
            ExistingSelection(1),
        ),
        uploads=(IncomingImage("new.png", image_bytes("PNG")),),
    )
    assert card.category_ids == (category_id,)
    assert card.sort_order == 9
    assert card.image_count == 3
    paths = derive_image_paths(card.example_image_path, 3, image_directory)
    assert all(path.suffix == ".png" and path.is_file() for path in paths)
    assert not (image_directory / "original-01.jpg").exists()


def test_update_card_missing_id_keeps_files(service_context):
    service, _, image_directory = service_context
    with pytest.raises(PromptCardNotFoundError):
        service.update_card(
            999,
            title="标题",
            prompt_text="提示词",
            selections=(UploadSelection(0),),
            uploads=(IncomingImage("new.jpg", image_bytes("JPEG")),),
        )
    assert list(image_directory.iterdir()) == []


def test_update_card_database_failure_restores_original_files(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/original-01.jpg",
    )
    original = image_bytes("JPEG")
    original_path = image_directory / "original-01.jpg"
    original_path.write_bytes(original)

    def fail_update(*args, **kwargs):
        raise RuntimeError("db failed")

    monkeypatch.setattr(repository, "update_prompt_card_content", fail_update)

    with pytest.raises(RuntimeError, match="db failed"):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(ExistingSelection(1),),
            uploads=(),
        )
    assert original_path.read_bytes() == original


def test_delete_card_removes_database_row_and_images(service_context):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="可删除",
        prompt_text="提示词",
        example_image_path="prompt-images/delete-01.jpg",
        image_count=2,
    )
    for index in (1, 2):
        (image_directory / f"delete-{index:02d}.jpg").write_bytes(
            image_bytes("JPEG")
        )
    service.delete_card(card_id)
    assert repository.get_prompt_card(card_id) is None
    assert list(image_directory.glob("delete-*.jpg")) == []


def test_delete_card_in_use_keeps_row_and_images(service_context):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="已使用",
        prompt_text="提示词",
        example_image_path="prompt-images/used-01.jpg",
    )
    image_path = image_directory / "used-01.jpg"
    image_path.write_bytes(image_bytes("JPEG"))
    repository._connection.execute(
        "INSERT INTO generation_history "
        "(prompt_card_id, image_path, model, aspect_ratio, resolution) "
        "VALUES (?, ?, ?, ?, ?)",
        (card_id, "generated/1.png", "model", "1:1", "1K"),
    )
    repository._connection.commit()
    with pytest.raises(PromptCardInUseError):
        service.delete_card(card_id)
    assert repository.get_prompt_card(card_id) is not None
    assert image_path.is_file()


def test_delete_card_logs_file_cleanup_failure(
    service_context,
    monkeypatch,
    caplog,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="清理失败",
        prompt_text="提示词",
        example_image_path="prompt-images/fail-01.jpg",
    )
    target = image_directory / "fail-01.jpg"
    target.write_bytes(image_bytes("JPEG"))
    original_unlink = Path.unlink

    def fail_target(path: Path, *args, **kwargs):
        if path == target:
            raise OSError("unlink failed")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_target)
    service.delete_card(card_id)
    assert repository.get_prompt_card(card_id) is None
    assert "删除卡片示例图失败" in caplog.text
