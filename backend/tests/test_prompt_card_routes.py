import asyncio
from io import BytesIO
import logging
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from starlette.requests import Request as StarletteRequest

import app.routes.prompt_cards as prompt_card_routes
from app.auth import hash_password
from app.config import Settings
from app.main import create_app
from app.prompt_card_repository import PromptCardRepository

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


def _image_bytes(format_name: str = "JPEG") -> bytes:
    output = BytesIO()
    Image.new("RGB", (4, 4), "red").save(output, format=format_name)
    return output.getvalue()


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

    (image_directory / "0001-01.jpg").write_bytes(_image_bytes())
    (image_directory / "0001-02.jpg").write_bytes(_image_bytes())

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


def test_create_prompt_card_requires_token(
    prompt_card_client: TestClient,
) -> None:
    response = prompt_card_client.post(
        "/api/prompt-cards",
        data={
            "title": "标题",
            "prompt_text": "提示词",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
        },
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )

    assert response.status_code == 401


@pytest.mark.parametrize(
    ("http_method", "path"),
    [
        ("post", "/api/prompt-cards"),
        ("put", "/api/prompt-cards/1"),
    ],
)
def test_unauthenticated_broken_multipart_returns_401(
    prompt_card_client: TestClient,
    http_method: str,
    path: str,
) -> None:
    response = getattr(prompt_card_client, http_method)(
        path,
        headers={"Content-Type": "multipart/form-data"},
        content=b"broken",
    )

    assert response.status_code == 401


@pytest.mark.parametrize(
    ("http_method", "path"),
    [
        ("post", "/api/prompt-cards"),
        ("put", "/api/prompt-cards/1"),
    ],
)
def test_authenticated_broken_multipart_returns_chinese_400(
    prompt_card_client: TestClient,
    password: str,
    http_method: str,
    path: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = getattr(prompt_card_client, http_method)(
        path,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "multipart/form-data",
        },
        content=b"broken",
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "表单数据无效"


def test_create_prompt_card_rejects_too_many_form_fields(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "标题",
            "prompt_text": "提示词",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
            "extra": "多余字段",
        },
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "表单数据无效"


def test_create_prompt_card_rejects_too_many_files(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "标题",
            "prompt_text": "提示词",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
        },
        files=[
            ("new_images", (f"{index}.jpg", b"x", "image/jpeg"))
            for index in range(21)
        ],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "表单数据无效"


def test_create_prompt_card_rejects_missing_form_field(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "标题",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
        },
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "表单数据无效"


def test_create_prompt_card_rejects_file_in_text_field(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "prompt_text": "提示词",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
        },
        files=[
            ("title", ("title.txt", b"title", "text/plain")),
            ("new_images", ("one.jpg", _image_bytes(), "image/jpeg")),
        ],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "表单数据无效"


def test_create_prompt_card_returns_complete_item(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": " 新标题 ",
            "prompt_text": " 新提示词 ",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
        },
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "新标题"
    assert body["category_ids"] == []
    assert body["image_count"] == 1
    assert body["images"][0]["url"].startswith("/media/prompt-images/")


def test_update_prompt_card_mixes_existing_and_upload(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.put(
        "/api/prompt-cards/1",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "编辑标题",
            "prompt_text": "编辑提示词",
            "image_manifest": (
                '[{"kind":"existing","image_index":2},'
                '{"kind":"upload","file_index":0}]'
            ),
        },
        files=[("new_images", ("new.png", _image_bytes("PNG"), "image/png"))],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "编辑标题"
    assert body["image_count"] == 2
    assert all(image["path"].endswith(".png") for image in body["images"])


def test_delete_prompt_card_without_history_returns_204(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.delete(
        "/api/prompt-cards/1",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    assert response.content == b""
    assert not list(
        prompt_card_client.app.state.settings.image_directory.glob("0001-*.jpg")
    )


@pytest.mark.parametrize(
    ("title", "prompt_text", "manifest", "expected_detail"),
    [
        ("   ", "提示词", '[{"kind":"upload","file_index":0}]', "请输入标题"),
        ("标题", "   ", '[{"kind":"upload","file_index":0}]', "请输入提示词"),
        ("标题", "提示词", "[]", "请至少上传一张示例图"),
    ],
)
def test_create_prompt_card_rejects_invalid_form(
    prompt_card_client: TestClient,
    password: str,
    title: str,
    prompt_text: str,
    manifest: str,
    expected_detail: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": title,
            "prompt_text": prompt_text,
            "image_manifest": manifest,
        },
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == expected_detail


def test_create_prompt_card_rejects_broken_image(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "标题",
            "prompt_text": "提示词",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
        },
        files=[("new_images", ("broken.jpg", b"broken", "image/jpeg"))],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "图片文件已损坏或格式不受支持"


def test_create_prompt_card_rejects_large_upload(
    prompt_card_client: TestClient,
    password: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(prompt_card_routes, "MAX_IMAGE_BYTES", 3)
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "标题",
            "prompt_text": "提示词",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
        },
        files=[("new_images", ("large.jpg", b"1234", "image/jpeg"))],
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "单张图片不能超过 20 MB"


def test_create_prompt_card_rejects_large_total_upload(
    prompt_card_client: TestClient,
    password: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(prompt_card_routes, "MAX_TOTAL_UPLOAD_BYTES", 3)
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "标题",
            "prompt_text": "提示词",
            "image_manifest": (
                '[{"kind":"upload","file_index":0},'
                '{"kind":"upload","file_index":1}]'
            ),
        },
        files=[
            ("new_images", ("one.jpg", b"12", "image/jpeg")),
            ("new_images", ("two.jpg", b"34", "image/jpeg")),
        ],
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "单次上传总量不能超过 100 MB"


def test_new_image_reader_uses_explicit_size_limit() -> None:
    class RecordingUpload:
        filename = "one.jpg"

        def __init__(self) -> None:
            self.read_sizes: list[int] = []

        async def read(self, size: int = -1) -> bytes:
            self.read_sizes.append(size)
            return b"ok"

    upload = RecordingUpload()
    result = asyncio.run(prompt_card_routes._read_new_images([upload]))  # type: ignore[list-item]

    assert result[0].content == b"ok"
    assert upload.read_sizes == [prompt_card_routes.MAX_IMAGE_BYTES + 1]


def test_update_missing_prompt_card_returns_404(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.put(
        "/api/prompt-cards/999",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "标题",
            "prompt_text": "提示词",
            "image_manifest": '[{"kind":"upload","file_index":0}]',
        },
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "提示词卡片不存在"


def test_delete_missing_prompt_card_returns_404(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    token = _login(prompt_card_client, password)
    response = prompt_card_client.delete(
        "/api/prompt-cards/999",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "提示词卡片不存在"


def test_delete_prompt_card_in_use_returns_409_and_keeps_file(
    prompt_card_client: TestClient,
    password: str,
) -> None:
    settings = prompt_card_client.app.state.settings
    connection = sqlite3.connect(settings.database_path)
    connection.execute(
        "INSERT INTO generation_history "
        "(prompt_card_id, image_path, model, aspect_ratio, resolution) "
        "VALUES (?, ?, ?, ?, ?)",
        (1, "generated/1.png", "model", "1:1", "1K"),
    )
    connection.commit()
    connection.close()
    token = _login(prompt_card_client, password)

    response = prompt_card_client.delete(
        "/api/prompt-cards/1",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "该提示词存在生成历史，无法删除"
    assert (settings.image_directory / "0001-01.jpg").is_file()


def test_prompt_card_mutations_require_token(
    prompt_card_client: TestClient,
) -> None:
    form = {
        "title": "标题",
        "prompt_text": "提示词",
        "image_manifest": '[{"kind":"upload","file_index":0}]',
    }
    files = [("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))]

    assert (
        prompt_card_client.post(
            "/api/prompt-cards",
            data=form,
            files=files,
        ).status_code
        == 401
    )
    assert (
        prompt_card_client.put(
            "/api/prompt-cards/1",
            data=form,
            files=files,
        ).status_code
        == 401
    )
    assert prompt_card_client.delete("/api/prompt-cards/1").status_code == 401


@pytest.mark.parametrize(
    ("method_name", "http_method", "path", "expected_detail"),
    [
        ("create_card", "post", "/api/prompt-cards", "保存提示词失败"),
        ("update_card", "put", "/api/prompt-cards/1", "保存提示词失败"),
        ("delete_card", "delete", "/api/prompt-cards/1", "删除提示词失败"),
    ],
)
def test_prompt_card_mutations_hide_unexpected_errors(
    prompt_card_client: TestClient,
    password: str,
    monkeypatch: pytest.MonkeyPatch,
    method_name: str,
    http_method: str,
    path: str,
    expected_detail: str,
) -> None:
    def raise_unexpected(*args: object, **kwargs: object) -> None:
        raise RuntimeError("内部敏感信息")

    monkeypatch.setattr(
        prompt_card_routes.PromptCardWriteService,
        method_name,
        raise_unexpected,
    )
    token = _login(prompt_card_client, password)
    request = getattr(prompt_card_client, http_method)
    request_arguments: dict[str, object] = {
        "headers": {"Authorization": f"Bearer {token}"},
    }
    if http_method != "delete":
        request_arguments.update(
            data={
                "title": "标题",
                "prompt_text": "提示词",
                "image_manifest": '[{"kind":"upload","file_index":0}]',
            },
            files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
        )

    response = request(path, **request_arguments)

    assert response.status_code == 500
    assert response.json()["detail"] == expected_detail
    assert "内部敏感信息" not in response.text


@pytest.mark.parametrize(
    ("http_method", "path", "expected_detail", "expected_log"),
    [
        ("post", "/api/prompt-cards", "保存提示词失败", "创建提示词失败"),
        ("put", "/api/prompt-cards/1", "保存提示词失败", "编辑提示词失败"),
        ("delete", "/api/prompt-cards/1", "删除提示词失败", "删除提示词失败"),
    ],
)
def test_prompt_card_mutations_hide_database_connection_errors(
    prompt_card_client: TestClient,
    password: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    http_method: str,
    path: str,
    expected_detail: str,
    expected_log: str,
) -> None:
    token = _login(prompt_card_client, password)

    def fail_connect(*args: object, **kwargs: object) -> None:
        raise sqlite3.OperationalError("内部数据库地址")

    monkeypatch.setattr(prompt_card_routes.sqlite3, "connect", fail_connect)
    request_arguments: dict[str, object] = {
        "headers": {"Authorization": f"Bearer {token}"},
    }
    if http_method != "delete":
        request_arguments.update(
            data={
                "title": "标题",
                "prompt_text": "提示词",
                "image_manifest": '[{"kind":"upload","file_index":0}]',
            },
            files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
        )

    with (
        TestClient(
            prompt_card_client.app,
            raise_server_exceptions=False,
        ) as safe_client,
        caplog.at_level(logging.ERROR, logger="app.prompt_cards"),
    ):
        response = getattr(safe_client, http_method)(path, **request_arguments)

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["detail"] == expected_detail
    assert "内部数据库地址" not in response.text
    assert any(expected_log in record.message for record in caplog.records)


def test_create_prompt_card_hides_form_parser_errors(
    prompt_card_client: TestClient,
    password: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    token = _login(prompt_card_client, password)

    async def fail_form(*args: object, **kwargs: object) -> None:
        raise RuntimeError("内部解析器信息")

    monkeypatch.setattr(StarletteRequest, "form", fail_form)
    with (
        TestClient(
            prompt_card_client.app,
            raise_server_exceptions=False,
        ) as safe_client,
        caplog.at_level(logging.ERROR, logger="app.prompt_cards"),
    ):
        response = safe_client.post(
            "/api/prompt-cards",
            headers={"Authorization": f"Bearer {token}"},
            data={
                "title": "标题",
                "prompt_text": "提示词",
                "image_manifest": '[{"kind":"upload","file_index":0}]',
            },
            files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
        )

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["detail"] == "保存提示词失败"
    assert "内部解析器信息" not in response.text
    assert any("创建提示词失败" in record.message for record in caplog.records)


def test_update_prompt_card_hides_image_reader_errors(
    prompt_card_client: TestClient,
    password: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    token = _login(prompt_card_client, password)

    async def fail_read(*args: object, **kwargs: object) -> None:
        raise RuntimeError("内部存储信息")

    monkeypatch.setattr(prompt_card_routes, "_read_new_images", fail_read)
    with (
        TestClient(
            prompt_card_client.app,
            raise_server_exceptions=False,
        ) as safe_client,
        caplog.at_level(logging.ERROR, logger="app.prompt_cards"),
    ):
        response = safe_client.put(
            "/api/prompt-cards/1",
            headers={"Authorization": f"Bearer {token}"},
            data={
                "title": "标题",
                "prompt_text": "提示词",
                "image_manifest": '[{"kind":"upload","file_index":0}]',
            },
            files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
        )

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["detail"] == "保存提示词失败"
    assert "内部存储信息" not in response.text
    assert any("编辑提示词失败" in record.message for record in caplog.records)


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
    assert response.content == _image_bytes()


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
