from io import BytesIO
import sqlite3
from pathlib import Path

import pytest
from PIL import Image

from app.prompt_card_images import derive_image_paths
from app.prompt_card_repository import PromptCardInUseError, PromptCardRepository
from app.prompt_card_uploads import (
    ExistingSelection,
    IncomingImage,
    PromptCardValidationError,
    UploadSelection,
)
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


def test_prompt_card_not_found_error_has_stable_chinese_message():
    error = PromptCardNotFoundError(999)

    assert str(error) == "提示词卡片不存在：999"


@pytest.mark.parametrize(
    ("title", "prompt_text", "message"),
    (
        ("   ", "提示词", "请输入标题"),
        ("标题", "   ", "请输入提示词"),
    ),
)
def test_create_card_rejects_empty_text_before_writing(
    service_context,
    title,
    prompt_text,
    message,
):
    service, repository, image_directory = service_context

    with pytest.raises(PromptCardValidationError, match=message) as caught:
        service.create_card(
            title=title,
            prompt_text=prompt_text,
            selections=(UploadSelection(0),),
            uploads=(IncomingImage("new.jpg", image_bytes("JPEG")),),
        )

    assert caught.value.code == "empty_text"
    assert repository.list_prompt_cards() == []
    assert list(image_directory.iterdir()) == []


def test_create_card_database_failure_removes_written_images(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context

    def fail_create(**kwargs):
        raise RuntimeError("数据库创建失败")

    monkeypatch.setattr(repository, "create_prompt_card_with_result", fail_create)

    with pytest.raises(RuntimeError, match="数据库创建失败"):
        service.create_card(
            title="标题",
            prompt_text="提示词",
            selections=(UploadSelection(0),),
            uploads=(IncomingImage("new.jpg", image_bytes("JPEG")),),
        )
    assert list(image_directory.iterdir()) == []


def test_create_card_preserves_database_error_when_one_cleanup_fails(
    service_context,
    monkeypatch,
    caplog,
):
    service, repository, image_directory = service_context

    def fail_create(**kwargs):
        raise RuntimeError("数据库创建失败")

    original_unlink = Path.unlink
    failed_once = False

    def fail_first_image_unlink(path: Path, *args, **kwargs):
        nonlocal failed_once
        if path.suffix == ".jpg" and not failed_once:
            failed_once = True
            raise OSError("模拟单图回收失败")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(repository, "create_prompt_card_with_result", fail_create)
    monkeypatch.setattr(Path, "unlink", fail_first_image_unlink)

    with pytest.raises(RuntimeError, match="数据库创建失败"):
        service.create_card(
            title="标题",
            prompt_text="提示词",
            selections=(UploadSelection(0), UploadSelection(1)),
            uploads=(
                IncomingImage("one.jpg", image_bytes("JPEG")),
                IncomingImage("two.jpg", image_bytes("JPEG")),
            ),
        )

    assert repository.list_prompt_cards() == []
    assert list(image_directory.glob("*.jpg")) == []
    assert "回收新建卡片图片失败" in caplog.text


def test_create_card_unlinks_formal_image_when_isolation_replace_fails(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context

    def fail_create(**kwargs):
        raise RuntimeError("数据库创建失败")

    original_replace = Path.replace
    failed_once = False

    def fail_first_isolation(path: Path, destination: Path):
        nonlocal failed_once
        if (
            path.parent == image_directory
            and destination.parent.name == "discard"
            and not failed_once
        ):
            failed_once = True
            raise OSError("移动正式图片到隔离目录失败")
        return original_replace(path, destination)

    monkeypatch.setattr(repository, "create_prompt_card_with_result", fail_create)
    monkeypatch.setattr(Path, "replace", fail_first_isolation)

    with pytest.raises(RuntimeError, match="数据库创建失败"):
        service.create_card(
            title="标题",
            prompt_text="提示词",
            selections=(UploadSelection(0), UploadSelection(1)),
            uploads=(
                IncomingImage("one.jpg", image_bytes("JPEG")),
                IncomingImage("two.jpg", image_bytes("JPEG")),
            ),
        )

    assert repository.list_prompt_cards() == []
    assert list(image_directory.glob("*.jpg")) == []


def test_create_card_logs_formal_residue_and_continues_after_double_failure(
    service_context,
    monkeypatch,
    caplog,
):
    service, repository, image_directory = service_context

    def fail_create(**kwargs):
        raise RuntimeError("数据库创建失败")

    original_replace = Path.replace
    original_unlink = Path.unlink
    failed_name = None

    def fail_first_isolation(path: Path, destination: Path):
        nonlocal failed_name
        if (
            path.parent == image_directory
            and destination.parent.name == "discard"
            and failed_name is None
        ):
            failed_name = path.name
            raise OSError("移动正式图片到隔离目录失败")
        return original_replace(path, destination)

    def fail_residue_unlink(path: Path, *args, **kwargs):
        if path.parent == image_directory and path.name == failed_name:
            raise OSError("删除正式残留失败")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(repository, "create_prompt_card_with_result", fail_create)
    monkeypatch.setattr(Path, "replace", fail_first_isolation)
    monkeypatch.setattr(Path, "unlink", fail_residue_unlink)

    with pytest.raises(RuntimeError, match="数据库创建失败"):
        service.create_card(
            title="标题",
            prompt_text="提示词",
            selections=(UploadSelection(0), UploadSelection(1)),
            uploads=(
                IncomingImage("one.jpg", image_bytes("JPEG")),
                IncomingImage("two.jpg", image_bytes("JPEG")),
            ),
        )

    visible = list(image_directory.glob("*.jpg"))
    assert len(visible) == 1
    assert visible[0].name == failed_name
    assert "正式路径仍有残留，需人工处理" in caplog.text
    assert str(visible[0]) in caplog.text


def test_create_card_does_not_read_again_after_atomic_commit(
    service_context,
    monkeypatch,
):
    service, repository, _ = service_context
    original_create = repository.create_prompt_card
    original_atomic_create = repository.create_prompt_card_with_result
    original_get = repository.get_prompt_card
    committed = False

    def track_old_create(**kwargs):
        nonlocal committed
        card_id = original_create(**kwargs)
        committed = True
        return card_id

    def track_atomic_create(**kwargs):
        nonlocal committed
        card = original_atomic_create(**kwargs)
        committed = True
        return card

    def fail_post_commit_read(card_id):
        if committed:
            raise RuntimeError("提交后重读失败")
        return original_get(card_id)

    monkeypatch.setattr(repository, "create_prompt_card", track_old_create)
    monkeypatch.setattr(
        repository,
        "create_prompt_card_with_result",
        track_atomic_create,
    )
    monkeypatch.setattr(repository, "get_prompt_card", fail_post_commit_read)

    card = service.create_card(
        title="原子创建",
        prompt_text="提示词",
        selections=(UploadSelection(0),),
        uploads=(IncomingImage("new.jpg", image_bytes("JPEG")),),
    )

    assert card.title == "原子创建"
    assert original_get(card.id) == card


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
    with pytest.raises(
        PromptCardNotFoundError,
        match="提示词卡片不存在：999",
    ):
        service.update_card(
            999,
            title="标题",
            prompt_text="提示词",
            selections=(UploadSelection(0),),
            uploads=(IncomingImage("new.jpg", image_bytes("JPEG")),),
        )
    assert list(image_directory.iterdir()) == []


@pytest.mark.parametrize(
    ("title", "prompt_text", "message"),
    (
        ("   ", "提示词", "请输入标题"),
        ("标题", "   ", "请输入提示词"),
    ),
)
def test_update_card_rejects_empty_text_without_changes(
    service_context,
    title,
    prompt_text,
    message,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/empty-01.jpg",
    )
    original = image_bytes("JPEG")
    image_path = image_directory / "empty-01.jpg"
    image_path.write_bytes(original)

    with pytest.raises(PromptCardValidationError, match=message):
        service.update_card(
            card_id,
            title=title,
            prompt_text=prompt_text,
            selections=(ExistingSelection(1),),
            uploads=(),
        )

    card = repository.get_prompt_card(card_id)
    assert card is not None
    assert (card.title, card.prompt_text) == ("旧标题", "旧提示词")
    assert image_path.read_bytes() == original


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
        raise RuntimeError("数据库更新失败")

    monkeypatch.setattr(
        repository,
        "update_prompt_card_content_with_result",
        fail_update,
    )

    with pytest.raises(RuntimeError, match="数据库更新失败"):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(ExistingSelection(1),),
            uploads=(),
        )
    assert original_path.read_bytes() == original


def test_update_card_restores_database_and_image_when_atomic_read_is_missing(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/read-none-01.jpg",
    )
    original = image_bytes("JPEG")
    old_path = image_directory / "read-none-01.jpg"
    old_path.write_bytes(original)
    original_get = repository.get_prompt_card
    read_count = 0

    def return_none_for_atomic_read(target_card_id):
        nonlocal read_count
        read_count += 1
        if read_count == 1:
            return original_get(target_card_id)
        return None

    monkeypatch.setattr(repository, "get_prompt_card", return_none_for_atomic_read)

    with pytest.raises(
        RuntimeError,
        match="更新提示词卡片后无法读取数据",
    ):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(UploadSelection(0),),
            uploads=(IncomingImage("new.png", image_bytes("PNG")),),
        )

    card = original_get(card_id)
    assert card is not None
    assert (card.title, card.prompt_text) == ("旧标题", "旧提示词")
    assert card.example_image_path == "prompt-images/read-none-01.jpg"
    assert old_path.read_bytes() == original
    assert not (image_directory / "read-none-01.png").exists()


def test_update_card_restores_old_files_when_new_cleanup_fails(
    service_context,
    monkeypatch,
    caplog,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/cleanup-01.jpg",
        image_count=2,
    )
    originals = (
        image_bytes("JPEG"),
        image_bytes("JPEG", (0, 255, 0, 255)),
    )
    for index, content in enumerate(originals, start=1):
        (image_directory / f"cleanup-{index:02d}.jpg").write_bytes(content)

    def fail_update(*args, **kwargs):
        raise RuntimeError("数据库更新失败")

    original_unlink = Path.unlink
    failed_once = False

    def fail_first_image_unlink(path: Path, *args, **kwargs):
        nonlocal failed_once
        if path.suffix == ".jpg" and not failed_once:
            failed_once = True
            raise OSError("模拟新图删除失败")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(
        repository,
        "update_prompt_card_content_with_result",
        fail_update,
    )
    monkeypatch.setattr(Path, "unlink", fail_first_image_unlink)

    with pytest.raises(RuntimeError, match="数据库更新失败"):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(UploadSelection(0), UploadSelection(1)),
            uploads=(
                IncomingImage("one.jpg", image_bytes("JPEG", (0, 0, 255, 255))),
                IncomingImage("two.jpg", image_bytes("JPEG", (255, 255, 0, 255))),
            ),
        )

    card = repository.get_prompt_card(card_id)
    assert card is not None
    assert (card.title, card.prompt_text) == ("旧标题", "旧提示词")
    for index, content in enumerate(originals, start=1):
        assert (image_directory / f"cleanup-{index:02d}.jpg").read_bytes() == content
    assert "回收更新后的卡片图片失败" in caplog.text


def test_update_card_unlinks_png_when_isolation_replace_fails(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/isolate-01.jpg",
    )
    original = image_bytes("JPEG")
    old_path = image_directory / "isolate-01.jpg"
    old_path.write_bytes(original)

    def fail_update(*args, **kwargs):
        raise RuntimeError("数据库更新失败")

    original_replace = Path.replace

    def fail_png_isolation(path: Path, destination: Path):
        if (
            path.parent == image_directory
            and path.suffix == ".png"
            and destination.parent.name == "discard"
        ):
            raise OSError("移动 PNG 到隔离目录失败")
        return original_replace(path, destination)

    monkeypatch.setattr(
        repository,
        "update_prompt_card_content_with_result",
        fail_update,
    )
    monkeypatch.setattr(Path, "replace", fail_png_isolation)

    with pytest.raises(RuntimeError, match="数据库更新失败"):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(UploadSelection(0),),
            uploads=(IncomingImage("new.png", image_bytes("PNG")),),
        )

    card = repository.get_prompt_card(card_id)
    assert card is not None
    assert (card.title, card.prompt_text) == ("旧标题", "旧提示词")
    assert old_path.read_bytes() == original
    assert not (image_directory / "isolate-01.png").exists()


def test_update_card_restores_partial_backup_when_second_backup_fails(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/backup-01.jpg",
        image_count=2,
    )
    originals = (image_bytes("JPEG"), image_bytes("JPEG", (0, 255, 0, 255)))
    old_paths = []
    for index, content in enumerate(originals, start=1):
        path = image_directory / f"backup-{index:02d}.jpg"
        path.write_bytes(content)
        old_paths.append(path)
    original_replace = Path.replace

    def fail_second_backup(path: Path, destination: Path):
        if path == old_paths[1] and destination.parent.name == "backup":
            raise OSError("备份第二张旧图失败")
        return original_replace(path, destination)

    monkeypatch.setattr(Path, "replace", fail_second_backup)

    with pytest.raises(OSError, match="备份第二张旧图失败"):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(ExistingSelection(1), ExistingSelection(2)),
            uploads=(),
        )

    for path, content in zip(old_paths, originals, strict=True):
        assert path.read_bytes() == content


def test_update_card_restores_old_files_when_second_new_replace_fails(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/replace-01.jpg",
        image_count=2,
    )
    originals = (image_bytes("JPEG"), image_bytes("JPEG", (0, 255, 0, 255)))
    old_paths = []
    for index, content in enumerate(originals, start=1):
        path = image_directory / f"replace-{index:02d}.jpg"
        path.write_bytes(content)
        old_paths.append(path)
    original_replace = Path.replace

    def fail_second_new_replace(path: Path, destination: Path):
        if path.parent.name == "new" and path.name == "replace-02.jpg":
            raise OSError("替换第二张新图失败")
        return original_replace(path, destination)

    monkeypatch.setattr(Path, "replace", fail_second_new_replace)

    with pytest.raises(OSError, match="替换第二张新图失败"):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(UploadSelection(0), UploadSelection(1)),
            uploads=(
                IncomingImage("one.jpg", image_bytes("JPEG", (0, 0, 255, 255))),
                IncomingImage("two.jpg", image_bytes("JPEG", (255, 255, 0, 255))),
            ),
        )

    for path, content in zip(old_paths, originals, strict=True):
        assert path.read_bytes() == content


def test_update_card_preserves_unrestored_backup_and_original_error(
    service_context,
    monkeypatch,
    caplog,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/recovery-01.jpg",
        image_count=3,
    )
    originals = (
        image_bytes("JPEG"),
        image_bytes("JPEG", (0, 255, 0, 255)),
        image_bytes("JPEG", (0, 0, 255, 255)),
    )
    for index, content in enumerate(originals, start=1):
        (image_directory / f"recovery-{index:02d}.jpg").write_bytes(content)

    def fail_update(*args, **kwargs):
        raise RuntimeError("数据库更新失败")

    original_replace = Path.replace

    def fail_second_restore(path: Path, destination: Path):
        if path.parent.name == "backup" and path.name == "recovery-02.jpg":
            raise OSError("恢复第二张旧图失败")
        return original_replace(path, destination)

    monkeypatch.setattr(
        repository,
        "update_prompt_card_content_with_result",
        fail_update,
    )
    monkeypatch.setattr(Path, "replace", fail_second_restore)

    with pytest.raises(RuntimeError, match="数据库更新失败"):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(
                ExistingSelection(1),
                ExistingSelection(2),
                ExistingSelection(3),
            ),
            uploads=(),
        )

    assert (image_directory / "recovery-01.jpg").read_bytes() == originals[0]
    assert (image_directory / "recovery-03.jpg").read_bytes() == originals[2]
    preserved = list(
        image_directory.glob(".recovery-*/backup/recovery-02.jpg")
    )
    assert len(preserved) == 1
    assert preserved[0].read_bytes() == originals[1]
    assert "恢复卡片原示例图失败" in caplog.text
    assert str(preserved[0]) in caplog.text


def test_update_card_does_not_read_again_after_atomic_commit(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/atomic-01.jpg",
    )
    (image_directory / "atomic-01.jpg").write_bytes(image_bytes("JPEG"))
    original_update = repository.update_prompt_card_content
    original_atomic_update = repository.update_prompt_card_content_with_result
    original_get = repository.get_prompt_card
    committed = False

    def track_old_update(*args, **kwargs):
        nonlocal committed
        updated = original_update(*args, **kwargs)
        committed = True
        return updated

    def track_atomic_update(*args, **kwargs):
        nonlocal committed
        card = original_atomic_update(*args, **kwargs)
        committed = True
        return card

    def fail_post_commit_read(target_card_id):
        if committed:
            raise RuntimeError("提交后重读失败")
        return original_get(target_card_id)

    monkeypatch.setattr(repository, "update_prompt_card_content", track_old_update)
    monkeypatch.setattr(
        repository,
        "update_prompt_card_content_with_result",
        track_atomic_update,
    )
    monkeypatch.setattr(repository, "get_prompt_card", fail_post_commit_read)

    card = service.update_card(
        card_id,
        title="原子更新",
        prompt_text="新提示词",
        selections=(ExistingSelection(1),),
        uploads=(),
    )

    assert card.title == "原子更新"
    assert original_get(card_id) == card


def test_update_card_logs_backup_cleanup_listing_failure_after_commit(
    service_context,
    monkeypatch,
    caplog,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/listing-01.jpg",
    )
    (image_directory / "listing-01.jpg").write_bytes(image_bytes("JPEG"))
    original_iterdir = Path.iterdir

    def fail_backup_listing(path: Path):
        if path.name == "backup":
            raise OSError("读取备份目录失败")
        return original_iterdir(path)

    monkeypatch.setattr(Path, "iterdir", fail_backup_listing)

    card = service.update_card(
        card_id,
        title="新标题",
        prompt_text="新提示词",
        selections=(ExistingSelection(1),),
        uploads=(),
    )

    assert card.title == "新标题"
    assert repository.get_prompt_card(card_id) == card
    assert (image_directory / "listing-01.jpg").is_file()
    assert "读取待清理的卡片原图备份失败" in caplog.text


def test_update_card_staging_failure_leaves_no_empty_recovery_directory(
    service_context,
    monkeypatch,
):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/staging-01.jpg",
    )
    original = image_bytes("JPEG")
    old_path = image_directory / "staging-01.jpg"
    old_path.write_bytes(original)

    def fail_staging(*args, **kwargs):
        raise OSError("暂存新图失败")

    monkeypatch.setattr(service, "_write_staged", fail_staging)

    with pytest.raises(OSError, match="暂存新图失败"):
        service.update_card(
            card_id,
            title="新标题",
            prompt_text="新提示词",
            selections=(ExistingSelection(1),),
            uploads=(),
        )

    card = repository.get_prompt_card(card_id)
    assert card is not None
    assert (card.title, card.prompt_text) == ("旧标题", "旧提示词")
    assert old_path.read_bytes() == original
    assert list(image_directory.glob(".recovery-*")) == []


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


def test_delete_missing_card_has_stable_chinese_message(service_context):
    service, _, image_directory = service_context

    with pytest.raises(
        PromptCardNotFoundError,
        match="提示词卡片不存在：999",
    ):
        service.delete_card(999)

    assert list(image_directory.iterdir()) == []


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
            raise OSError("删除文件失败")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_target)
    service.delete_card(card_id)
    assert repository.get_prompt_card(card_id) is None
    assert "删除卡片示例图失败" in caplog.text
