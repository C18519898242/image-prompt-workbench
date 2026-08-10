# 提示词库卡片管理实施计划

> **面向智能执行者：** 实施本计划时必须使用 `subagent-driven-development`（推荐）或 `executing-plans` 技能，按任务逐项执行。所有步骤使用复选框跟踪。

**目标：** 为现有提示词库增加经过鉴权的网页端新增、编辑和删除能力，并可靠管理 1 至 20 张本地 JPG/PNG 示例图。

**架构：** 后端新增与 FastAPI 解耦的图片清单校验模块和卡片写入服务，由服务协调 SQLite 仓储与文件系统的暂存、替换和回滚；HTTP 路由只负责鉴权、读取 multipart 请求和映射业务错误。前端新增 API 封装、纯图片队列模型与右侧编辑抽屉，提示词库页面负责列表状态和删除流程。

**技术栈：** Python 3、FastAPI、SQLite、Pillow、pytest、React、TypeScript、Vitest、Testing Library、原生 CSS。

## 全局约束

- 项目内新增或修改的文档、界面文案、错误信息和代码注释必须使用中文。
- 所有新增、编辑、删除接口继续使用现有 Bearer Token 鉴权。
- 标题和提示词正文去除首尾空白后必须非空。
- 每张卡片必须包含 1 至 20 张示例图，只接受内容真实有效的 JPG 或 PNG。
- 单张新上传图片不超过 20 MB；单次请求的新上传图片总量不超过 100 MB。
- 同一卡片图片使用统一后缀：最终图片全部为 JPEG 时使用 `.jpg`；只要包含 PNG 就用 Pillow 统一编码为 `.png`。
- 新建卡片不关联分类；编辑卡片不得改变已有分类和 `sort_order`。
- 有生成历史的卡片不得删除，接口返回 409；无生成历史的卡片删除后清理示例图。
- 桌面端抽屉宽度 `40vw`、最小 480 px、最大 720 px；视口宽度不超过 768 px 时全屏。
- 严格执行 TDD：每个行为先写失败测试、确认失败，再写最小实现并确认通过。
- 只暂存当前任务列出的文件，不提交 `.idea/`、`.superpowers/`、`data/logs/` 或 `data/tmp-pytest/`。

---

## 文件结构

### 后端

- 新建 `backend/app/prompt_card_uploads.py`：定义图片清单类型、上传限制、JSON 解析、真实格式检查和统一编码。
- 新建 `backend/app/prompt_card_write_service.py`：协调图片暂存、正式文件替换、数据库写入、回滚和删除。
- 修改 `backend/app/prompt_card_repository.py`：增加保留分类与排序的内容更新接口，并将外键删除冲突转换为稳定业务异常。
- 修改 `backend/app/routes/prompt_cards.py`：新增 POST、PUT、DELETE 路由及 multipart 读取辅助函数。
- 新建 `backend/tests/test_prompt_card_uploads.py`：覆盖清单与图片内容校验。
- 新建 `backend/tests/test_prompt_card_write_service.py`：覆盖创建、编辑、回滚与删除文件的一致性。
- 修改 `backend/tests/test_prompt_card_repository.py`：覆盖保留元数据更新和删除冲突。
- 修改 `backend/tests/test_prompt_card_routes.py`：覆盖鉴权 HTTP 写接口和错误状态码。

### 前端

- 修改 `frontend/src/api.ts`：解析后端错误详情并增加卡片新增、编辑、删除 API。
- 修改 `frontend/src/api.test.ts`：验证 FormData、图片清单、DELETE 和中文错误详情。
- 新建 `frontend/src/promptCardEditor.ts`：定义编辑器图片联合类型、初始化、移动、移除和序列化纯函数。
- 新建 `frontend/src/promptCardEditor.test.ts`：覆盖图片队列和 manifest 生成。
- 新建 `frontend/src/components/PromptCardEditorDrawer.tsx`：实现新增/编辑右侧抽屉、校验、预览、拖动、按钮排序和未保存确认。
- 新建 `frontend/src/components/PromptCardEditorDrawer.test.tsx`：覆盖抽屉核心交互与错误保留。
- 修改 `frontend/src/components/PromptCardCard.tsx`：增加卡片操作菜单及编辑、删除回调。
- 修改 `frontend/src/components/PromptLibraryPage.tsx`：管理抽屉、列表增量更新和删除流程。
- 修改 `frontend/src/components/PromptLibraryPage.test.tsx`：覆盖新增、编辑、删除、409 和 401 集成行为。
- 修改 `frontend/src/index.css`：增加工具栏主操作、卡片菜单、遮罩、抽屉、图片队列和响应式样式。
- 修改 `README.md`：补充网页端管理卡片的使用和限制说明。

---

### 任务 1：收紧仓储层的更新与删除语义

**文件：**

- 修改：`backend/app/prompt_card_repository.py`
- 测试：`backend/tests/test_prompt_card_repository.py`

**接口：**

- 产出：`class PromptCardInUseError(Exception)`。
- 产出：`PromptCardRepository.update_prompt_card_content(card_id: int, *, title: str, prompt_text: str, example_image_path: str, image_count: int) -> bool`，保留原 `sort_order` 和分类关联。
- 调整：`PromptCardRepository.delete_prompt_card(card_id: int) -> bool` 在外键冲突时抛出 `PromptCardInUseError`，不存在仍返回 `False`。

- [ ] **步骤 1：为保留分类与排序的更新写失败测试**

在 `backend/tests/test_prompt_card_repository.py` 增加：

```python
def test_update_prompt_card_content_preserves_sort_and_categories(repository):
    category_id = repository.create_category("人物")
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/old-01.jpg",
        image_count=2,
        sort_order=7,
        category_ids=[category_id],
    )

    updated = repository.update_prompt_card_content(
        card_id,
        title="新标题",
        prompt_text="新提示词",
        example_image_path="prompt-images/new-01.png",
        image_count=3,
    )

    card = repository.get_prompt_card(card_id)
    assert updated is True
    assert card is not None
    assert (card.title, card.prompt_text) == ("新标题", "新提示词")
    assert card.example_image_path == "prompt-images/new-01.png"
    assert card.image_count == 3
    assert card.sort_order == 7
    assert card.category_ids == (category_id,)
```

- [ ] **步骤 2：运行测试并确认因接口缺失而失败**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_prompt_card_repository.py::test_update_prompt_card_content_preserves_sort_and_categories -q
```

预期：失败，错误包含 `AttributeError: 'PromptCardRepository' object has no attribute 'update_prompt_card_content'`。

- [ ] **步骤 3：实现只更新内容与图片元数据的仓储接口**

在 `PromptCardRepository` 中增加：

```python
def update_prompt_card_content(
    self,
    card_id: int,
    *,
    title: str,
    prompt_text: str,
    example_image_path: str,
    image_count: int,
) -> bool:
    normalized_image_count = self._normalize_image_count(image_count)
    with self._connection:
        cursor = self._connection.execute(
            "UPDATE prompt_cards SET title = ?, prompt_text = ?, "
            "example_image_path = ?, image_count = ?, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (
                title,
                prompt_text,
                example_image_path,
                normalized_image_count,
                card_id,
            ),
        )
    return cursor.rowcount > 0
```

- [ ] **步骤 4：为生成历史阻止删除写失败测试**

把异常加入测试导入，并增加：

```python
from app.prompt_card_repository import PromptCardInUseError, PromptCardRepository


def test_delete_prompt_card_with_generation_history_raises(repository):
    card_id = repository.create_prompt_card(
        title="已使用卡片",
        prompt_text="提示词",
        example_image_path="prompt-images/used-01.jpg",
    )
    repository._connection.execute(
        "INSERT INTO generation_history "
        "(prompt_card_id, image_path, model, aspect_ratio, resolution) "
        "VALUES (?, ?, ?, ?, ?)",
        (card_id, "generated/1.png", "model", "1:1", "1K"),
    )
    repository._connection.commit()

    with pytest.raises(PromptCardInUseError):
        repository.delete_prompt_card(card_id)

    assert repository.get_prompt_card(card_id) is not None
```

- [ ] **步骤 5：运行删除测试并确认当前暴露 SQLite 异常**

运行：

```powershell
python -m pytest tests/test_prompt_card_repository.py::test_delete_prompt_card_with_generation_history_raises -q
```

预期：失败，当前抛出 `sqlite3.IntegrityError`，而不是 `PromptCardInUseError`。

- [ ] **步骤 6：实现稳定的仓储业务异常**

在模块顶部和删除方法中加入：

```python
class PromptCardInUseError(Exception):
    """卡片被生成历史引用，不能删除。"""


def delete_prompt_card(self, card_id: int) -> bool:
    try:
        with self._connection:
            cursor = self._connection.execute(
                "DELETE FROM prompt_cards WHERE id = ?",
                (card_id,),
            )
    except sqlite3.IntegrityError as error:
        raise PromptCardInUseError(card_id) from error
    return cursor.rowcount > 0
```

- [ ] **步骤 7：运行仓储层完整测试**

运行：

```powershell
python -m pytest tests/test_prompt_card_repository.py -q
```

预期：全部通过。

- [ ] **步骤 8：提交仓储层变更**

```powershell
Set-Location ..
git add backend/app/prompt_card_repository.py backend/tests/test_prompt_card_repository.py
git commit -m "feat: 收紧提示词卡片更新和删除语义"
```

---

### 任务 2：实现图片清单解析与内容验证

**文件：**

- 新建：`backend/app/prompt_card_uploads.py`
- 新建：`backend/tests/test_prompt_card_uploads.py`

**接口：**

- 产出：`IncomingImage(filename: str, content: bytes)`。
- 产出：`ExistingSelection(image_index: int)` 与 `UploadSelection(file_index: int)`。
- 产出：`parse_image_manifest(raw: str) -> tuple[ImageSelection, ...]`。
- 产出：`prepare_final_images(selections, existing_images, uploads) -> PreparedImages`。
- 产出：`PromptCardValidationError(code: str, message: str)`；错误码至少包含 `invalid_manifest`、`empty_images`、`too_many_images`、`image_too_large`、`total_too_large`、`invalid_image`。

- [ ] **步骤 1：写清单解析失败测试**

新建 `backend/tests/test_prompt_card_uploads.py`：

```python
import pytest

from app.prompt_card_uploads import (
    ExistingSelection,
    PromptCardValidationError,
    UploadSelection,
    parse_image_manifest,
)


def test_parse_image_manifest_accepts_mixed_order():
    result = parse_image_manifest(
        '[{"kind":"existing","image_index":2},'
        '{"kind":"upload","file_index":0}]'
    )
    assert result == (ExistingSelection(2), UploadSelection(0))


@pytest.mark.parametrize(
    "raw",
    [
        "not-json",
        "{}",
        "[]",
        '[{"kind":"existing","image_index":1},'
        '{"kind":"existing","image_index":1}]',
        '[{"kind":"upload","file_index":-1}]',
    ],
)
def test_parse_image_manifest_rejects_invalid_shape(raw):
    with pytest.raises(PromptCardValidationError) as captured:
        parse_image_manifest(raw)
    assert captured.value.code in {"invalid_manifest", "empty_images"}
```

- [ ] **步骤 2：运行测试并确认模块不存在**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_prompt_card_uploads.py -q
```

预期：收集失败，错误包含 `ModuleNotFoundError: No module named 'app.prompt_card_uploads'`。

- [ ] **步骤 3：实现清单类型、限制和严格解析**

新建 `backend/app/prompt_card_uploads.py`，先写入以下骨架并完成所有分支：

```python
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import json
from typing import Mapping, Sequence

from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_IMAGE_COUNT = 20


class PromptCardValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class IncomingImage:
    filename: str
    content: bytes


@dataclass(frozen=True)
class ExistingSelection:
    image_index: int


@dataclass(frozen=True)
class UploadSelection:
    file_index: int


ImageSelection = ExistingSelection | UploadSelection


@dataclass(frozen=True)
class PreparedImages:
    extension: str
    contents: tuple[bytes, ...]


def parse_image_manifest(raw: str) -> tuple[ImageSelection, ...]:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise PromptCardValidationError("invalid_manifest", "图片顺序数据无效") from error
    if not isinstance(payload, list):
        raise PromptCardValidationError("invalid_manifest", "图片顺序数据无效")
    if not payload:
        raise PromptCardValidationError("empty_images", "请至少上传一张示例图")
    if len(payload) > MAX_IMAGE_COUNT:
        raise PromptCardValidationError("too_many_images", "每张卡片最多上传 20 张图片")

    selections: list[ImageSelection] = []
    seen: set[tuple[str, int]] = set()
    for item in payload:
        if not isinstance(item, dict) or item.get("kind") not in {"existing", "upload"}:
            raise PromptCardValidationError("invalid_manifest", "图片顺序数据无效")
        field = "image_index" if item["kind"] == "existing" else "file_index"
        value = item.get(field)
        minimum = 1 if item["kind"] == "existing" else 0
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise PromptCardValidationError("invalid_manifest", "图片顺序数据无效")
        key = (item["kind"], value)
        if key in seen:
            raise PromptCardValidationError("invalid_manifest", "图片顺序数据存在重复引用")
        seen.add(key)
        selections.append(
            ExistingSelection(value) if item["kind"] == "existing" else UploadSelection(value)
        )
    return tuple(selections)
```

- [ ] **步骤 4：为真实格式、限制和统一 PNG 编码写失败测试**

在测试文件加入创建图片的辅助函数与用例：

```python
from io import BytesIO

from PIL import Image

from app.prompt_card_uploads import IncomingImage, prepare_final_images


def image_bytes(format_name: str, color=(255, 0, 0, 255)) -> bytes:
    mode = "RGBA" if format_name == "PNG" else "RGB"
    image = Image.new(mode, (4, 4), color if mode == "RGBA" else color[:3])
    output = BytesIO()
    image.save(output, format=format_name)
    return output.getvalue()


def test_prepare_final_images_keeps_all_jpeg():
    uploads = [IncomingImage("one.jpg", image_bytes("JPEG"))]
    result = prepare_final_images((UploadSelection(0),), {}, uploads)
    assert result.extension == ".jpg"
    assert result.contents == (uploads[0].content,)


def test_prepare_final_images_converts_mixed_input_to_png():
    uploads = [
        IncomingImage("one.jpg", image_bytes("JPEG")),
        IncomingImage("two.png", image_bytes("PNG")),
    ]
    result = prepare_final_images(
        (UploadSelection(0), UploadSelection(1)), {}, uploads
    )
    assert result.extension == ".png"
    assert all(content.startswith(b"\x89PNG") for content in result.contents)


def test_prepare_final_images_rejects_fake_jpeg():
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0),), {}, [IncomingImage("fake.jpg", b"not-image")]
        )
    assert captured.value.code == "invalid_image"
```

使用 `monkeypatch` 把限制缩小，避免测试分配 100 MB 内存，并增加：

```python
import app.prompt_card_uploads as uploads_module


def test_prepare_final_images_rejects_single_file_limit(monkeypatch):
    monkeypatch.setattr(uploads_module, "MAX_IMAGE_BYTES", 3)
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0),), {}, [IncomingImage("large.jpg", b"1234")]
        )
    assert captured.value.code == "image_too_large"


def test_prepare_final_images_rejects_total_limit(monkeypatch):
    first = IncomingImage("one.jpg", image_bytes("JPEG"))
    second = IncomingImage("two.jpg", image_bytes("JPEG"))
    monkeypatch.setattr(uploads_module, "MAX_TOTAL_UPLOAD_BYTES", len(first.content) + len(second.content) - 1)
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0), UploadSelection(1)), {}, [first, second]
        )
    assert captured.value.code == "total_too_large"


def test_prepare_final_images_rejects_count_limit(monkeypatch):
    monkeypatch.setattr(uploads_module, "MAX_IMAGE_COUNT", 1)
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0), UploadSelection(1)),
            {},
            [IncomingImage("one.jpg", b"x"), IncomingImage("two.jpg", b"y")],
        )
    assert captured.value.code == "too_many_images"


@pytest.mark.parametrize(
    ("selections", "existing", "uploads"),
    [
        ((ExistingSelection(2),), {1: image_bytes("JPEG")}, []),
        ((UploadSelection(1),), {}, [IncomingImage("one.jpg", image_bytes("JPEG"))]),
        ((UploadSelection(0),), {}, [IncomingImage("one.jpg", image_bytes("JPEG")), IncomingImage("unused.jpg", image_bytes("JPEG"))]),
    ],
)
def test_prepare_final_images_rejects_missing_references(selections, existing, uploads):
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(selections, existing, uploads)
    assert captured.value.code == "invalid_manifest"
```

- [ ] **步骤 5：实现图片解析、限制检查和编码**

在 `prompt_card_uploads.py` 增加以下完整逻辑：

```python
def _detect_format(content: bytes) -> str:
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
            format_name = image.format
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise PromptCardValidationError("invalid_image", "图片文件已损坏或格式不受支持") from error
    if format_name not in {"JPEG", "PNG"}:
        raise PromptCardValidationError("invalid_image", "仅支持 JPG 和 PNG 图片")
    return format_name


def _encode_png(content: bytes) -> bytes:
    try:
        with Image.open(BytesIO(content)) as image:
            image.load()
            output = BytesIO()
            image.save(output, format="PNG")
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise PromptCardValidationError("invalid_image", "图片转换失败") from error


def prepare_final_images(
    selections: Sequence[ImageSelection],
    existing_images: Mapping[int, bytes],
    uploads: Sequence[IncomingImage],
) -> PreparedImages:
    if not selections:
        raise PromptCardValidationError("empty_images", "请至少上传一张示例图")
    if len(selections) > MAX_IMAGE_COUNT:
        raise PromptCardValidationError("too_many_images", "每张卡片最多上传 20 张图片")
    if any(len(upload.content) > MAX_IMAGE_BYTES for upload in uploads):
        raise PromptCardValidationError("image_too_large", "单张图片不能超过 20 MB")
    if sum(len(upload.content) for upload in uploads) > MAX_TOTAL_UPLOAD_BYTES:
        raise PromptCardValidationError("total_too_large", "单次上传总量不能超过 100 MB")

    referenced_uploads = {
        selection.file_index
        for selection in selections
        if isinstance(selection, UploadSelection)
    }
    if referenced_uploads != set(range(len(uploads))):
        raise PromptCardValidationError("invalid_manifest", "上传图片清单与文件不一致")

    contents: list[bytes] = []
    for selection in selections:
        if isinstance(selection, ExistingSelection):
            content = existing_images.get(selection.image_index)
            if content is None:
                raise PromptCardValidationError("invalid_manifest", "原图片引用不存在")
        else:
            if selection.file_index >= len(uploads):
                raise PromptCardValidationError("invalid_manifest", "上传图片引用不存在")
            content = uploads[selection.file_index].content
        contents.append(content)

    formats = [_detect_format(content) for content in contents]
    if "PNG" in formats:
        return PreparedImages(".png", tuple(_encode_png(content) for content in contents))
    return PreparedImages(".jpg", tuple(contents))
```

- [ ] **步骤 6：运行图片清单测试**

运行：

```powershell
python -m pytest tests/test_prompt_card_uploads.py -q
```

预期：全部通过。

- [ ] **步骤 7：提交图片验证模块**

```powershell
Set-Location ..
git add backend/app/prompt_card_uploads.py backend/tests/test_prompt_card_uploads.py
git commit -m "feat: 校验提示词卡片图片清单"
```

---

### 任务 3：实现卡片写入服务与文件回滚

**文件：**

- 新建：`backend/app/prompt_card_write_service.py`
- 新建：`backend/tests/test_prompt_card_write_service.py`

**接口：**

- 消费：任务 1 的 `update_prompt_card_content`、`PromptCardInUseError`。
- 消费：任务 2 的 `IncomingImage`、`ImageSelection`、`prepare_final_images`。
- 产出：`PromptCardNotFoundError`。
- 产出：`PromptCardWriteService.create_card(...) -> PromptCard`。
- 产出：`PromptCardWriteService.update_card(card_id, ...) -> PromptCard`。
- 产出：`PromptCardWriteService.delete_card(card_id) -> None`。

- [ ] **步骤 1：写创建与新建分类为空的失败测试**

新建测试文件，复用真实 schema 和临时目录：

```python
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
```

- [ ] **步骤 2：运行测试并确认服务模块缺失**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_prompt_card_write_service.py::test_create_card_writes_numbered_images_and_empty_categories -q
```

预期：收集失败，错误包含 `ModuleNotFoundError`。

- [ ] **步骤 3：实现创建流程和共享辅助函数**

新建 `backend/app/prompt_card_write_service.py`，实现以下接口；正式文件相对路径必须始终使用 `prompt-images/<前缀>-01.<后缀>`：

```python
from __future__ import annotations

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
    def __init__(self, repository: PromptCardRepository, image_directory: Path) -> None:
        self._repository = repository
        self._image_directory = image_directory

    @staticmethod
    def _normalize_text(value: str, message: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise PromptCardValidationError("empty_text", message)
        return normalized

    def _relative_first_path(self, prefix: str, extension: str) -> str:
        return f"prompt-images/{prefix}-01{extension}"

    def _write_staged(self, directory: Path, prefix: str, extension: str, contents: tuple[bytes, ...]) -> list[Path]:
        directory.mkdir(parents=True, exist_ok=True)
        paths = []
        for index, content in enumerate(contents, start=1):
            path = directory / f"{prefix}-{index:02d}{extension}"
            path.write_bytes(content)
            paths.append(path)
        return paths

    def create_card(self, *, title: str, prompt_text: str, selections: tuple[ImageSelection, ...], uploads: tuple[IncomingImage, ...]) -> PromptCard:
        title = self._normalize_text(title, "请输入标题")
        prompt_text = self._normalize_text(prompt_text, "请输入提示词")
        prepared = prepare_final_images(selections, {}, uploads)
        self._image_directory.mkdir(parents=True, exist_ok=True)
        prefix = uuid4().hex
        final_paths: list[Path] = []
        with tempfile.TemporaryDirectory(dir=self._image_directory, prefix=".card-") as temporary:
            staged = self._write_staged(Path(temporary), prefix, prepared.extension, prepared.contents)
            try:
                for staged_path in staged:
                    final_path = self._image_directory / staged_path.name
                    staged_path.replace(final_path)
                    final_paths.append(final_path)
                card_id = self._repository.create_prompt_card(
                    title=title,
                    prompt_text=prompt_text,
                    example_image_path=self._relative_first_path(prefix, prepared.extension),
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
```

- [ ] **步骤 4：为编辑混排、保留分类和数据库失败回滚写测试**

增加三个用例：

```python
def test_update_card_reorders_existing_and_upload_and_preserves_metadata(service_context):
    service, repository, image_directory = service_context
    category_id = repository.create_category("保留分类")
    card_id = repository.create_prompt_card(
        title="旧标题", prompt_text="旧提示词",
        example_image_path="prompt-images/original-01.jpg",
        image_count=2, sort_order=9, category_ids=[category_id],
    )
    first, second = image_bytes("JPEG"), image_bytes("JPEG", (0, 255, 0, 255))
    (image_directory / "original-01.jpg").write_bytes(first)
    (image_directory / "original-02.jpg").write_bytes(second)

    card = service.update_card(
        card_id,
        title="新标题",
        prompt_text="新提示词",
        selections=(ExistingSelection(2), UploadSelection(0), ExistingSelection(1)),
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
            999, title="标题", prompt_text="提示词",
            selections=(UploadSelection(0),),
            uploads=(IncomingImage("new.jpg", image_bytes("JPEG")),),
        )
    assert list(image_directory.iterdir()) == []


def test_update_card_database_failure_restores_original_files(service_context, monkeypatch):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="旧标题", prompt_text="旧提示词",
        example_image_path="prompt-images/original-01.jpg",
    )
    original = image_bytes("JPEG")
    original_path = image_directory / "original-01.jpg"
    original_path.write_bytes(original)
    monkeypatch.setattr(repository, "update_prompt_card_content", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("db failed")))

    with pytest.raises(RuntimeError, match="db failed"):
        service.update_card(
            card_id, title="新标题", prompt_text="新提示词",
            selections=(ExistingSelection(1),), uploads=(),
        )
    assert original_path.read_bytes() == original
```

- [ ] **步骤 5：实现编辑时暂存、备份、替换与恢复**

在服务中增加 `_read_existing`、`_restore_backup` 和 `update_card`。关键顺序必须严格如下：读取原卡片 → 读取旧图 → 准备目标图片 → 把旧图移动到临时备份 → 把新图移到正式路径 → 更新数据库 → 失败时删除新图并恢复备份 → 成功后退出临时目录自动清理备份。

```python
def _read_existing(self, card: PromptCard) -> dict[int, bytes]:
    paths = derive_image_paths(card.example_image_path, card.image_count, self._image_directory)
    try:
        return {index: path.read_bytes() for index, path in enumerate(paths, start=1)}
    except OSError as error:
        raise PromptCardValidationError("invalid_image", "原示例图文件不可用") from error

def update_card(self, card_id: int, *, title: str, prompt_text: str, selections: tuple[ImageSelection, ...], uploads: tuple[IncomingImage, ...]) -> PromptCard:
    card = self._repository.get_prompt_card(card_id)
    if card is None:
        raise PromptCardNotFoundError(card_id)
    title = self._normalize_text(title, "请输入标题")
    prompt_text = self._normalize_text(prompt_text, "请输入提示词")
    prepared = prepare_final_images(selections, self._read_existing(card), uploads)
    old_paths = derive_image_paths(card.example_image_path, card.image_count, self._image_directory)
    prefix = Path(card.example_image_path).stem.rsplit("-", 1)[0]
    new_paths: list[Path] = []
    with tempfile.TemporaryDirectory(dir=self._image_directory, prefix=".card-") as temporary:
        temporary_path = Path(temporary)
        staged = self._write_staged(temporary_path / "new", prefix, prepared.extension, prepared.contents)
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
                example_image_path=self._relative_first_path(prefix, prepared.extension),
                image_count=len(prepared.contents),
            )
            if not updated:
                raise PromptCardNotFoundError(card_id)
        except Exception:
            for path in new_paths:
                path.unlink(missing_ok=True)
            for backup in backup_directory.iterdir():
                backup.replace(self._image_directory / backup.name)
            raise
    updated_card = self._repository.get_prompt_card(card_id)
    if updated_card is None:
        raise PromptCardNotFoundError(card_id)
    return updated_card
```

- [ ] **步骤 6：为删除成功、删除冲突和文件清理失败写测试**

增加以下用例；第三个用例只让目标图片的 `unlink` 失败，避免影响 pytest 的临时目录清理：

```python
def test_delete_card_removes_database_row_and_images(service_context):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="可删除", prompt_text="提示词",
        example_image_path="prompt-images/delete-01.jpg", image_count=2,
    )
    for index in (1, 2):
        (image_directory / f"delete-{index:02d}.jpg").write_bytes(image_bytes("JPEG"))
    service.delete_card(card_id)
    assert repository.get_prompt_card(card_id) is None
    assert list(image_directory.glob("delete-*.jpg")) == []


def test_delete_card_in_use_keeps_row_and_images(service_context):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="已使用", prompt_text="提示词",
        example_image_path="prompt-images/used-01.jpg",
    )
    image_path = image_directory / "used-01.jpg"
    image_path.write_bytes(image_bytes("JPEG"))
    repository._connection.execute(
        "INSERT INTO generation_history (prompt_card_id, image_path, model, aspect_ratio, resolution) VALUES (?, ?, ?, ?, ?)",
        (card_id, "generated/1.png", "model", "1:1", "1K"),
    )
    repository._connection.commit()
    with pytest.raises(PromptCardInUseError):
        service.delete_card(card_id)
    assert repository.get_prompt_card(card_id) is not None
    assert image_path.is_file()


def test_delete_card_logs_file_cleanup_failure(service_context, monkeypatch, caplog):
    service, repository, image_directory = service_context
    card_id = repository.create_prompt_card(
        title="清理失败", prompt_text="提示词",
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
```

删除接口实现为：

```python
def delete_card(self, card_id: int) -> None:
    card = self._repository.get_prompt_card(card_id)
    if card is None:
        raise PromptCardNotFoundError(card_id)
    paths = derive_image_paths(card.example_image_path, card.image_count, self._image_directory)
    if not self._repository.delete_prompt_card(card_id):
        raise PromptCardNotFoundError(card_id)
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logging.getLogger("app.prompt_cards").exception("删除卡片示例图失败: %s", path.name)
```

- [ ] **步骤 7：运行写入服务与相关仓储测试**

运行：

```powershell
python -m pytest tests/test_prompt_card_write_service.py tests/test_prompt_card_repository.py -q
```

预期：全部通过；临时目录测试结束后不残留 `.card-*` 目录。

- [ ] **步骤 8：提交写入服务**

```powershell
Set-Location ..
git add backend/app/prompt_card_write_service.py backend/tests/test_prompt_card_write_service.py
git commit -m "feat: 原子保存提示词卡片和示例图"
```

---

### 任务 4：开放提示词卡片写入 HTTP API

**文件：**

- 修改：`backend/app/routes/prompt_cards.py`
- 修改：`backend/tests/test_prompt_card_routes.py`

**接口：**

- 消费：`parse_image_manifest`、`IncomingImage`、`PromptCardWriteService`。
- 产出：`POST /api/prompt-cards` 返回 201 `PromptCardItem`。
- 产出：`PUT /api/prompt-cards/{card_id}` 返回 200 `PromptCardItem`。
- 产出：`DELETE /api/prompt-cards/{card_id}` 返回 204、404 或 409。

- [ ] **步骤 1：把路由测试图片改为真实图片字节**

当前 fixture 使用 `b"jpg-one"`，新增内容验证后不再有效。把 `backend/tests/test_prompt_card_routes.py` 中图片写入改为 Pillow 生成的真实 JPEG，并提供：

```python
from io import BytesIO
from PIL import Image


def _image_bytes(format_name: str = "JPEG") -> bytes:
    output = BytesIO()
    Image.new("RGB", (4, 4), "red").save(output, format=format_name)
    return output.getvalue()
```

- [ ] **步骤 2：写 POST、PUT、DELETE 的鉴权与成功测试**

增加测试，构造 multipart 请求：

```python
def test_create_prompt_card_requires_token(prompt_card_client):
    response = prompt_card_client.post(
        "/api/prompt-cards",
        data={"title": "标题", "prompt_text": "提示词", "image_manifest": '[{"kind":"upload","file_index":0}]'},
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )
    assert response.status_code == 401


def test_create_prompt_card_returns_complete_item(prompt_card_client, password):
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": " 新标题 ", "prompt_text": " 新提示词 ", "image_manifest": '[{"kind":"upload","file_index":0}]'},
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "新标题"
    assert body["category_ids"] == []
    assert body["image_count"] == 1
    assert body["images"][0]["url"].startswith("/media/prompt-images/")
```

增加编辑混排测试和删除无历史成功测试：

```python
def test_update_prompt_card_mixes_existing_and_upload(prompt_card_client, password):
    token = _login(prompt_card_client, password)
    response = prompt_card_client.put(
        "/api/prompt-cards/1",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "编辑标题",
            "prompt_text": "编辑提示词",
            "image_manifest": '[{"kind":"existing","image_index":2},{"kind":"upload","file_index":0}]',
        },
        files=[("new_images", ("new.png", _image_bytes("PNG"), "image/png"))],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "编辑标题"
    assert body["image_count"] == 2
    assert all(image["path"].endswith(".png") for image in body["images"])


def test_delete_prompt_card_without_history_returns_204(prompt_card_client, password):
    token = _login(prompt_card_client, password)
    response = prompt_card_client.delete(
        "/api/prompt-cards/1",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 204
    assert response.content == b""
    assert not list(prompt_card_client.app.state.settings.image_directory.glob("0001-*.jpg"))
```

- [ ] **步骤 3：运行新增接口测试并确认 405**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_prompt_card_routes.py::test_create_prompt_card_returns_complete_item -q
```

预期：失败，状态码为 405。

- [ ] **步骤 4：实现 multipart 读取和 POST、PUT 路由**

在路由模块导入 `File`、`Form`、`UploadFile`，增加异步文件读取函数。读取时每个文件最多读取 `MAX_IMAGE_BYTES + 1` 字节，并累计总量，超过限制立即抛 `PromptCardValidationError`，不能无界调用 `await upload.read()`：

```python
async def _read_new_images(files: list[UploadFile]) -> tuple[IncomingImage, ...]:
    result: list[IncomingImage] = []
    total = 0
    for upload in files:
        content = await upload.read(MAX_IMAGE_BYTES + 1)
        if len(content) > MAX_IMAGE_BYTES:
            raise PromptCardValidationError("image_too_large", "单张图片不能超过 20 MB")
        total += len(content)
        if total > MAX_TOTAL_UPLOAD_BYTES:
            raise PromptCardValidationError("total_too_large", "单次上传总量不能超过 100 MB")
        result.append(IncomingImage(upload.filename or "image", content))
    return tuple(result)


def _category_map(repository: PromptCardRepository) -> dict[int, CategoryItem]:
    return {
        item.id: CategoryItem(id=item.id, name=item.name, sort_order=item.sort_order)
        for item in repository.list_categories()
    }
```

路由签名固定为：

```python
@router.post("/prompt-cards", response_model=PromptCardItem, status_code=status.HTTP_201_CREATED)
async def create_prompt_card(
    request: Request,
    title: str = Form(...),
    prompt_text: str = Form(...),
    image_manifest: str = Form(...),
    new_images: list[UploadFile] = File(default=[]),
    _: str = Depends(require_token),
) -> PromptCardItem:
    try:
        selections = parse_image_manifest(image_manifest)
        uploads = await _read_new_images(new_images)
    except PromptCardValidationError as error:
        raise _validation_http_error(error) from error
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        repository = PromptCardRepository(connection)
        service = PromptCardWriteService(repository, Path(request.app.state.settings.image_directory))
        card = service.create_card(
            title=title,
            prompt_text=prompt_text,
            selections=selections,
            uploads=uploads,
        )
        return _to_prompt_card_item(card, category_map=_category_map(repository))
    except PromptCardValidationError as error:
        raise _validation_http_error(error) from error
    except Exception as error:
        logging.getLogger("app.prompt_cards").exception("创建提示词失败")
        raise HTTPException(status_code=500, detail="保存提示词失败") from error
    finally:
        connection.close()


@router.put("/prompt-cards/{card_id}", response_model=PromptCardItem)
async def update_prompt_card(
    card_id: int,
    request: Request,
    title: str = Form(...),
    prompt_text: str = Form(...),
    image_manifest: str = Form(...),
    new_images: list[UploadFile] = File(default=[]),
    _: str = Depends(require_token),
) -> PromptCardItem:
    try:
        selections = parse_image_manifest(image_manifest)
        uploads = await _read_new_images(new_images)
    except PromptCardValidationError as error:
        raise _validation_http_error(error) from error
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        repository = PromptCardRepository(connection)
        service = PromptCardWriteService(repository, Path(request.app.state.settings.image_directory))
        card = service.update_card(
            card_id,
            title=title,
            prompt_text=prompt_text,
            selections=selections,
            uploads=uploads,
        )
        return _to_prompt_card_item(card, category_map=_category_map(repository))
    except PromptCardNotFoundError as error:
        raise HTTPException(status_code=404, detail="提示词卡片不存在") from error
    except PromptCardValidationError as error:
        raise _validation_http_error(error) from error
    except Exception as error:
        logging.getLogger("app.prompt_cards").exception("编辑提示词失败")
        raise HTTPException(status_code=500, detail="保存提示词失败") from error
    finally:
        connection.close()
```

每个路由创建 SQLite 连接、仓储和 `PromptCardWriteService`，使用 `try/finally` 关闭连接；成功后构建分类映射并调用现有 `_to_prompt_card_item`。抽取 `_map_write_error`，映射如下：

```python
ERROR_STATUS = {
    "image_too_large": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    "total_too_large": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
}

def _validation_http_error(error: PromptCardValidationError) -> HTTPException:
    return HTTPException(
        status_code=ERROR_STATUS.get(error.code, status.HTTP_400_BAD_REQUEST),
        detail=str(error),
    )
```

`PromptCardNotFoundError` 映射 404；未预期异常使用 `logging.getLogger("app.prompt_cards").exception(...)` 记录后返回统一 500“保存提示词失败”。

- [ ] **步骤 5：实现 DELETE 路由及冲突映射**

增加：

```python
@router.delete("/prompt-cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt_card_route(
    card_id: int,
    request: Request,
    _: str = Depends(require_token),
) -> None:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        repository = PromptCardRepository(connection)
        service = PromptCardWriteService(repository, Path(request.app.state.settings.image_directory))
        service.delete_card(card_id)
    except PromptCardNotFoundError as error:
        raise HTTPException(status_code=404, detail="提示词卡片不存在") from error
    except PromptCardInUseError as error:
        raise HTTPException(status_code=409, detail="该提示词存在生成历史，无法删除") from error
    except Exception as error:
        logging.getLogger("app.prompt_cards").exception("删除提示词失败")
        raise HTTPException(status_code=500, detail="删除提示词失败") from error
    finally:
        connection.close()
```

`PromptCardNotFoundError` 返回 404“提示词卡片不存在”；`PromptCardInUseError` 返回 409“该提示词存在生成历史，无法删除”；其他异常记录日志并返回 500“删除提示词失败”。

- [ ] **步骤 6：补齐错误状态测试**

增加以下测试；大文件测试通过缩小路由常量完成：

```python
import app.routes.prompt_cards as prompt_card_routes


@pytest.mark.parametrize(
    ("title", "prompt_text", "manifest", "expected_detail"),
    [
        ("   ", "提示词", '[{"kind":"upload","file_index":0}]', "请输入标题"),
        ("标题", "   ", '[{"kind":"upload","file_index":0}]', "请输入提示词"),
        ("标题", "提示词", "[]", "请至少上传一张示例图"),
    ],
)
def test_create_prompt_card_rejects_invalid_form(prompt_card_client, password, title, prompt_text, manifest, expected_detail):
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": title, "prompt_text": prompt_text, "image_manifest": manifest},
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )
    assert response.status_code == 400
    assert response.json()["detail"] == expected_detail


def test_create_prompt_card_rejects_broken_image(prompt_card_client, password):
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": "标题", "prompt_text": "提示词", "image_manifest": '[{"kind":"upload","file_index":0}]'},
        files=[("new_images", ("broken.jpg", b"broken", "image/jpeg"))],
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "图片文件已损坏或格式不受支持"


def test_create_prompt_card_rejects_large_upload(prompt_card_client, password, monkeypatch):
    monkeypatch.setattr(prompt_card_routes, "MAX_IMAGE_BYTES", 3)
    token = _login(prompt_card_client, password)
    response = prompt_card_client.post(
        "/api/prompt-cards",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": "标题", "prompt_text": "提示词", "image_manifest": '[{"kind":"upload","file_index":0}]'},
        files=[("new_images", ("large.jpg", b"1234", "image/jpeg"))],
    )
    assert response.status_code == 413


def test_update_missing_prompt_card_returns_404(prompt_card_client, password):
    token = _login(prompt_card_client, password)
    response = prompt_card_client.put(
        "/api/prompt-cards/999",
        headers={"Authorization": f"Bearer {token}"},
        data={"title": "标题", "prompt_text": "提示词", "image_manifest": '[{"kind":"upload","file_index":0}]'},
        files=[("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))],
    )
    assert response.status_code == 404


def test_delete_prompt_card_in_use_returns_409_and_keeps_file(prompt_card_client, password):
    settings = prompt_card_client.app.state.settings
    connection = sqlite3.connect(settings.database_path)
    connection.execute(
        "INSERT INTO generation_history (prompt_card_id, image_path, model, aspect_ratio, resolution) VALUES (?, ?, ?, ?, ?)",
        (1, "generated/1.png", "model", "1:1", "1K"),
    )
    connection.commit()
    connection.close()
    token = _login(prompt_card_client, password)
    response = prompt_card_client.delete("/api/prompt-cards/1", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 409
    assert response.json()["detail"] == "该提示词存在生成历史，无法删除"
    assert (settings.image_directory / "0001-01.jpg").is_file()


def test_prompt_card_mutations_require_token(prompt_card_client):
    form = {"title": "标题", "prompt_text": "提示词", "image_manifest": '[{"kind":"upload","file_index":0}]'}
    files = [("new_images", ("one.jpg", _image_bytes(), "image/jpeg"))]
    assert prompt_card_client.post("/api/prompt-cards", data=form, files=files).status_code == 401
    assert prompt_card_client.put("/api/prompt-cards/1", data=form, files=files).status_code == 401
    assert prompt_card_client.delete("/api/prompt-cards/1").status_code == 401
```

- [ ] **步骤 7：运行后端路由及完整后端测试**

运行：

```powershell
python -m pytest tests/test_prompt_card_routes.py -q
python -m pytest -q
```

预期：两条命令全部通过。

- [ ] **步骤 8：提交 HTTP API**

```powershell
Set-Location ..
git add backend/app/routes/prompt_cards.py backend/tests/test_prompt_card_routes.py
git commit -m "feat: 开放提示词卡片管理接口"
```

---

### 任务 5：扩展前端 API 与中文错误详情

**文件：**

- 修改：`frontend/src/api.ts`
- 修改：`frontend/src/api.test.ts`

**接口：**

- 产出：`PromptImageManifestItem` 联合类型。
- 产出：`PromptCardMutationRequest`。
- 产出：`createPromptCard(token, request) -> Promise<PromptCard>`。
- 产出：`updatePromptCard(token, cardId, request) -> Promise<PromptCard>`。
- 产出：`deletePromptCard(token, cardId) -> Promise<void>`。
- 调整：`ApiError.message` 优先使用后端 JSON `detail`。

- [ ] **步骤 1：写错误详情与 FormData 失败测试**

在 `frontend/src/api.test.ts` 增加：

```typescript
import {
  ApiError,
  createPromptCard,
  deletePromptCard,
  updatePromptCard,
} from "./api";

test("createPromptCard 提交图片清单和文件", async () => {
  const card = { id: 3, title: "标题", prompt_text: "提示词", sort_order: 0, category_ids: [], categories: [], image_count: 1, example_image_path: "prompt-images/x-01.jpg", images: [] };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(card), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const file = new File(["image"], "one.jpg", { type: "image/jpeg" });
  await createPromptCard("token", {
    title: "标题",
    prompt_text: "提示词",
    image_manifest: [{ kind: "upload", file_index: 0 }],
    new_images: [file],
  });
  const body = fetchMock.mock.calls[0][1].body as FormData;
  expect(JSON.parse(String(body.get("image_manifest")))).toEqual([{ kind: "upload", file_index: 0 }]);
  expect(body.getAll("new_images")).toEqual([file]);
});


test("API 错误使用后端中文 detail", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "该提示词存在生成历史，无法删除" }), { status: 409 })));
  await expect(deletePromptCard("token", 9)).rejects.toMatchObject({
    status: 409,
    message: "该提示词存在生成历史，无法删除",
  } satisfies Partial<ApiError>);
});
```

另写 `updatePromptCard` 的 PUT URL 测试和 `deletePromptCard` 的 DELETE/204 测试。

- [ ] **步骤 2：运行 API 测试并确认导出缺失**

运行：

```powershell
Set-Location frontend
npm test -- src/api.test.ts
```

预期：TypeScript/Vitest 失败，提示新导出不存在。

- [ ] **步骤 3：实现类型、FormData 构造和 CRUD 函数**

在 `frontend/src/api.ts` 增加：

```typescript
export type PromptImageManifestItem =
  | { kind: "existing"; image_index: number }
  | { kind: "upload"; file_index: number };

export type PromptCardMutationRequest = {
  title: string;
  prompt_text: string;
  image_manifest: PromptImageManifestItem[];
  new_images: File[];
};

function promptCardFormData(request: PromptCardMutationRequest): FormData {
  const body = new FormData();
  body.set("title", request.title);
  body.set("prompt_text", request.prompt_text);
  body.set("image_manifest", JSON.stringify(request.image_manifest));
  request.new_images.forEach((file) => body.append("new_images", file));
  return body;
}

async function mutatePromptCard(token: string, url: string, method: "POST" | "PUT", request: PromptCardMutationRequest): Promise<PromptCard> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: promptCardFormData(request),
  });
  return parseResponse<PromptCard>(response);
}

export function createPromptCard(token: string, request: PromptCardMutationRequest): Promise<PromptCard> {
  return mutatePromptCard(token, "/api/prompt-cards", "POST", request);
}

export function updatePromptCard(token: string, cardId: number, request: PromptCardMutationRequest): Promise<PromptCard> {
  return mutatePromptCard(token, `/api/prompt-cards/${cardId}`, "PUT", request);
}

export async function deletePromptCard(token: string, cardId: number): Promise<void> {
  const response = await fetch(`/api/prompt-cards/${cardId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await parseResponse<void>(response);
}
```

- [ ] **步骤 4：让 `parseResponse` 安全读取后端详情**

把失败分支改为：

```typescript
if (!response.ok) {
  let message = `请求失败（${response.status}）`;
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      message = payload.detail;
    }
  } catch {
    // 非 JSON 错误响应使用稳定的状态码文案。
  }
  throw new ApiError(response.status, message);
}
```

- [ ] **步骤 5：运行前端 API 测试**

运行：

```powershell
npm test -- src/api.test.ts
```

预期：全部通过。

- [ ] **步骤 6：提交前端 API**

```powershell
Set-Location ..
git add frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat: 增加提示词卡片前端接口"
```

---

### 任务 6：实现可独立测试的编辑器图片队列

**文件：**

- 新建：`frontend/src/promptCardEditor.ts`
- 新建：`frontend/src/promptCardEditor.test.ts`

**接口：**

- 消费：`PromptCard`、`PromptImageManifestItem`、`PromptCardMutationRequest`。
- 产出：`EditorImage` 联合类型。
- 产出：`initialEditorImages(card)`、`appendUploadImages`、`moveEditorImage`、`removeEditorImage`、`buildPromptCardMutation`。

- [ ] **步骤 1：写初始化、移动、删除和序列化失败测试**

新建测试文件，覆盖：

```typescript
import {
  appendUploadImages,
  buildPromptCardMutation,
  initialEditorImages,
  moveEditorImage,
  removeEditorImage,
} from "./promptCardEditor";

test("编辑卡片初始化为 existing 图片", () => {
  const images = initialEditorImages(cardB);
  expect(images.map((image) => image.kind)).toEqual(["existing", "existing"]);
  expect(images.map((image) => image.imageIndex)).toEqual([1, 2]);
});

test("混排图片生成连续上传索引", () => {
  const existing = initialEditorImages(cardB);
  const file = new File(["x"], "new.png", { type: "image/png" });
  const mixed = moveEditorImage(appendUploadImages(existing, [file]), 2, 1);
  const request = buildPromptCardMutation("标题", "提示词", mixed);
  expect(request.image_manifest).toEqual([
    { kind: "existing", image_index: 1 },
    { kind: "upload", file_index: 0 },
    { kind: "existing", image_index: 2 },
  ]);
  expect(request.new_images).toEqual([file]);
});

test("移动越界保持原数组，删除按 id 生效", () => {
  const images = initialEditorImages(cardB);
  expect(moveEditorImage(images, 0, -1)).toBe(images);
  expect(removeEditorImage(images, images[0].id)).toEqual([images[1]]);
});
```

测试内定义完整 `cardB: PromptCard` fixture，不从其他测试文件导入。

- [ ] **步骤 2：运行测试并确认模块不存在**

运行：

```powershell
Set-Location frontend
npm test -- src/promptCardEditor.test.ts
```

预期：失败，提示无法解析 `./promptCardEditor`。

- [ ] **步骤 3：实现纯状态模型**

新建 `frontend/src/promptCardEditor.ts`：

```typescript
import type { PromptCard, PromptCardMutationRequest } from "./api";

export type EditorImage =
  | { kind: "existing"; id: string; imageIndex: number; name: string; previewUrl: string }
  | { kind: "upload"; id: string; file: File; name: string; previewUrl: string };

export function initialEditorImages(card: PromptCard | null): EditorImage[] {
  return card?.images.map((image) => ({
    kind: "existing" as const,
    id: `existing-${image.index}`,
    imageIndex: image.index,
    name: image.path.split("/").pop() || `图片 ${image.index}`,
    previewUrl: image.url,
  })) ?? [];
}

export function appendUploadImages(current: EditorImage[], files: File[]): EditorImage[] {
  return [
    ...current,
    ...files.map((file) => ({
      kind: "upload" as const,
      id: crypto.randomUUID(),
      file,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
    })),
  ];
}

export function moveEditorImage(images: EditorImage[], from: number, to: number): EditorImage[] {
  if (from < 0 || to < 0 || from >= images.length || to >= images.length || from === to) return images;
  const next = [...images];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function removeEditorImage(images: EditorImage[], id: string): EditorImage[] {
  return images.filter((image) => image.id !== id);
}

export function buildPromptCardMutation(title: string, promptText: string, images: EditorImage[]): PromptCardMutationRequest {
  const uploads = images.filter((image): image is Extract<EditorImage, { kind: "upload" }> => image.kind === "upload");
  const uploadIndex = new Map(uploads.map((image, index) => [image.id, index]));
  return {
    title,
    prompt_text: promptText,
    image_manifest: images.map((image) => image.kind === "existing"
      ? { kind: "existing", image_index: image.imageIndex }
      : { kind: "upload", file_index: uploadIndex.get(image.id)! }),
    new_images: uploads.map((image) => image.file),
  };
}
```

- [ ] **步骤 4：补齐文件选择的前端快速校验**

先增加测试，通过构造带 `size` 的最小 `File` 替身避免分配大内存：

```typescript
import { validateSelectedFiles } from "./promptCardEditor";

function sizedFile(name: string, type: string, size: number): File {
  return { name, type, size } as File;
}

const twentyExisting = Array.from({ length: 20 }, (_, index) => ({
  kind: "existing" as const,
  id: `existing-${index}`,
  imageIndex: index + 1,
  name: `${index}.jpg`,
  previewUrl: `/media/${index}.jpg`,
}));

test.each([
  [[sizedFile("a.gif", "image/gif", 1)], [], "仅支持 JPG 和 PNG 图片"],
  [[sizedFile("a.jpg", "image/jpeg", 20 * 1024 * 1024 + 1)], [], "单张图片不能超过 20 MB"],
  [[sizedFile("a.jpg", "image/jpeg", 1)], twentyExisting, "每张卡片最多上传 20 张图片"],
  [[sizedFile("b.jpg", "image/jpeg", 41 * 1024 * 1024)], [{ kind: "upload", id: "a", file: sizedFile("a.jpg", "image/jpeg", 60 * 1024 * 1024), name: "a.jpg", previewUrl: "blob:a" }], "单次上传总量不能超过 100 MB"],
])("校验文件选择限制", (files, current, message) => {
  expect(validateSelectedFiles(files, current)).toBe(message);
});

test("合法 JPG 和 PNG 文件通过快速校验", () => {
  expect(validateSelectedFiles([
    sizedFile("a.jpg", "image/jpeg", 100),
    sizedFile("b.png", "image/png", 100),
  ], [])).toBeNull();
});
```

再实现：

```typescript
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_COUNT = 20;

export function validateSelectedFiles(files: File[], current: EditorImage[]): string | null {
  if (files.some((file) => !["image/jpeg", "image/png"].includes(file.type))) {
    return "仅支持 JPG 和 PNG 图片";
  }
  if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
    return "单张图片不能超过 20 MB";
  }
  if (current.length + files.length > MAX_IMAGE_COUNT) {
    return "每张卡片最多上传 20 张图片";
  }
  const existingUploadBytes = current.reduce(
    (total, image) => total + (image.kind === "upload" ? image.file.size : 0),
    0,
  );
  if (existingUploadBytes + files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_UPLOAD_BYTES) {
    return "单次上传总量不能超过 100 MB";
  }
  return null;
}
```

- [ ] **步骤 5：运行图片队列测试并执行类型构建**

运行：

```powershell
npm test -- src/promptCardEditor.test.ts
npm run build
```

预期：测试全部通过，构建成功。

- [ ] **步骤 6：提交编辑器状态模型**

```powershell
Set-Location ..
git add frontend/src/promptCardEditor.ts frontend/src/promptCardEditor.test.ts
git commit -m "feat: 建立提示词图片编辑队列"
```

---

### 任务 7：实现新增与编辑右侧抽屉

**文件：**

- 新建：`frontend/src/components/PromptCardEditorDrawer.tsx`
- 新建：`frontend/src/components/PromptCardEditorDrawer.test.tsx`
- 修改：`frontend/src/index.css`

**接口：**

- 消费：任务 5 的卡片新增、编辑 API。
- 消费：任务 6 的图片队列纯函数。
- 产出：`PromptCardEditorDrawerProps { token; mode; card; onClose; onSaved }`。

- [ ] **步骤 1：写新增表单必填和保存成功测试**

新建组件测试，先定义完整 fixture 和渲染辅助函数：

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import type { PromptCard } from "../api";
import { AuthProvider } from "../auth/AuthContext";
import { PromptCardEditorDrawer } from "./PromptCardEditorDrawer";

const savedCard: PromptCard = {
  id: 3,
  title: "新标题",
  prompt_text: "新提示词",
  sort_order: 0,
  category_ids: [],
  categories: [],
  image_count: 1,
  example_image_path: "prompt-images/new-01.jpg",
  images: [{ index: 1, path: "prompt-images/new-01.jpg", url: "/media/prompt-images/new-01.jpg" }],
};

const editableCard: PromptCard = {
  ...savedCard,
  id: 2,
  title: "旧标题",
  prompt_text: "旧提示词",
  example_image_path: "prompt-images/old-01.jpg",
  images: [{ index: 1, path: "prompt-images/old-01.jpg", url: "/media/prompt-images/old-01.jpg" }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(savedCard), { status: 201 })));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

function renderDrawer(options: {
  mode: "create" | "edit";
  card: PromptCard | null;
  onSaved?: (card: PromptCard) => void;
  onClose?: () => void;
}) {
  const onSaved = options.onSaved ?? vi.fn();
  const onClose = options.onClose ?? vi.fn();
  render(
    <AuthProvider>
      <PromptCardEditorDrawer
        token="token"
        mode={options.mode}
        card={options.card}
        onSaved={onSaved}
        onClose={onClose}
      />
    </AuthProvider>,
  );
  return { onSaved, onClose };
}

test("新增抽屉要求标题、提示词和至少一张图片", async () => {
  const user = userEvent.setup();
  renderDrawer({ mode: "create", card: null });
  await user.click(screen.getByRole("button", { name: "保存提示词" }));
  expect(screen.getByText("请输入标题")).toBeInTheDocument();
  expect(screen.getByText("请输入提示词")).toBeInTheDocument();
  expect(screen.getByText("请至少上传一张示例图")).toBeInTheDocument();
});


test("新增保存成功回传卡片", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  renderDrawer({ mode: "create", card: null, onSaved });
  await user.type(screen.getByLabelText("标题"), "新标题");
  await user.type(screen.getByLabelText("提示词正文"), "新提示词");
  await user.upload(screen.getByLabelText("上传示例图"), new File(["image"], "one.jpg", { type: "image/jpeg" }));
  await user.click(screen.getByRole("button", { name: "保存提示词" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedCard));
});
```

- [ ] **步骤 2：运行测试并确认组件缺失**

运行：

```powershell
Set-Location frontend
npm test -- src/components/PromptCardEditorDrawer.test.tsx
```

预期：失败，提示组件模块不存在。

- [ ] **步骤 3：实现抽屉结构、表单状态和提交**

组件必须：

- 使用 `role="dialog"`、`aria-modal="true"` 和可见标题；
- 新增模式标题为“新增提示词”，编辑模式为“编辑提示词”；
- 用 `useState` 保存标题、正文、图片、字段错误、操作错误和 `saving`；
- 根据 `mode` 调用 `createPromptCard` 或 `updatePromptCard`；
- 遇到 `ApiError(401)` 调用 `clearToken(token)`；
- 其他错误显示 `ApiError.message`，未知错误显示“保存提示词失败，请稍后重试”；
- 成功调用 `onSaved(card)`，由父组件关闭抽屉；
- 保存期间按钮文字为“保存中…”且禁用关闭和重复提交。

提交核心必须使用：

```typescript
const request = buildPromptCardMutation(title, promptText, images);
const saved = mode === "create"
  ? await createPromptCard(token, request)
  : await updatePromptCard(token, card!.id, request);
onSaved(saved);
```

- [ ] **步骤 4：实现图片预览、移除、按钮排序和拖动排序**

每张图片渲染缩略图、文件名、“前移”“后移”“移除”按钮；首张前移禁用、末张后移禁用。缩略图项设置 `draggable`，`onDragStart` 记录源索引，`onDrop` 调用 `moveEditorImage`。添加图片前调用 `validateSelectedFiles`；失败时清空 `<input>` 值并显示错误。

移除 upload 图片和组件卸载时调用 `URL.revokeObjectURL`；不得撤销 existing 图片的 `/media/...` URL。

- [ ] **步骤 5：实现未保存关闭确认和焦点行为**

初始快照包含标题、正文和图片 id 顺序。当前值与快照不同时，点击遮罩、关闭或取消先执行：

```typescript
if (dirty && !window.confirm("当前修改尚未保存，确定关闭吗？")) return;
onClose();
```

打开后聚焦标题输入框；按 Escape 走同一关闭确认；关闭后由父组件按钮自然恢复焦点。增加以下测试：

```typescript
test("编辑模式回填并在有修改时确认关闭", async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { onClose } = renderDrawer({ mode: "edit", card: editableCard });
  expect(screen.getByLabelText("标题")).toHaveValue("旧标题");
  await user.type(screen.getByLabelText("标题"), "修改");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(confirm).toHaveBeenCalledWith("当前修改尚未保存，确定关闭吗？");
  expect(onClose).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});


test("保存失败后保留文字和图片", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "保存提示词失败" }), { status: 500 })));
  const user = userEvent.setup();
  renderDrawer({ mode: "create", card: null });
  await user.type(screen.getByLabelText("标题"), "保留标题");
  await user.type(screen.getByLabelText("提示词正文"), "保留提示词");
  await user.upload(screen.getByLabelText("上传示例图"), new File(["image"], "one.jpg", { type: "image/jpeg" }));
  await user.click(screen.getByRole("button", { name: "保存提示词" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存提示词失败");
  expect(screen.getByLabelText("标题")).toHaveValue("保留标题");
  expect(screen.getByText("one.jpg")).toBeInTheDocument();
});


test("按钮排序改变提交清单且保存期间防重复提交", async () => {
  let resolveResponse!: (response: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderDrawer({ mode: "edit", card: { ...editableCard, image_count: 2, images: [
    editableCard.images[0],
    { index: 2, path: "prompt-images/old-02.jpg", url: "/media/prompt-images/old-02.jpg" },
  ] } });
  await user.click(screen.getByRole("button", { name: "图片 2 前移" }));
  await user.click(screen.getByRole("button", { name: "保存提示词" }));
  expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(JSON.parse(String(body.get("image_manifest")))).toEqual([
    { kind: "existing", image_index: 2 },
    { kind: "existing", image_index: 1 },
  ]);
  resolveResponse(new Response(JSON.stringify(savedCard), { status: 200 }));
});
```

- [ ] **步骤 6：添加抽屉和图片队列样式**

在 `frontend/src/index.css` 增加 `.prompt-editor-backdrop`、`.prompt-editor-drawer`、`.prompt-editor-form`、`.prompt-editor-images`、`.prompt-editor-image-item`、`.prompt-editor-actions` 等类。明确包含：

```css
.prompt-editor-drawer {
  position: fixed;
  inset: 0 0 0 auto;
  width: clamp(480px, 40vw, 720px);
  height: 100dvh;
  overflow-y: auto;
  background: var(--surface, #fff);
  box-shadow: -16px 0 40px rgb(15 23 42 / 18%);
  z-index: 60;
}

@media (max-width: 768px) {
  .prompt-editor-drawer { width: 100%; }
}
```

使用现有颜色和按钮 token，不引入新的前端依赖。

- [ ] **步骤 7：运行组件测试和构建**

运行：

```powershell
npm test -- src/components/PromptCardEditorDrawer.test.tsx src/promptCardEditor.test.ts
npm run build
```

预期：测试全部通过，构建成功。

- [ ] **步骤 8：提交编辑抽屉**

```powershell
Set-Location ..
git add frontend/src/components/PromptCardEditorDrawer.tsx frontend/src/components/PromptCardEditorDrawer.test.tsx frontend/src/index.css
git commit -m "feat: 实现提示词新增编辑抽屉"
```

---

### 任务 8：集成卡片菜单、列表更新和删除流程

**文件：**

- 修改：`frontend/src/components/PromptCardCard.tsx`
- 修改：`frontend/src/components/PromptLibraryPage.tsx`
- 修改：`frontend/src/components/PromptLibraryPage.test.tsx`
- 修改：`frontend/src/App.test.tsx`
- 修改：`frontend/src/index.css`

**接口：**

- 消费：`PromptCardEditorDrawer` 与 `deletePromptCard`。
- 调整：`PromptCardCardProps` 增加 `onEdit()`、`onDelete()`。
- 保持：`PromptLibraryPage` 对 `AppShell` 的现有 props 不变。

- [ ] **步骤 1：写新增入口、编辑入口和增量列表更新测试**

先把 Testing Library 导入改为 `import { render, screen, waitFor } from "@testing-library/react";`，再在 `PromptLibraryPage.test.tsx` 增加：

```typescript
test("从工具栏新增卡片并更新列表", async () => {
  const cardC = {
    ...cardA,
    id: 3,
    title: "新卡片",
    prompt_text: "新提示词",
    category_ids: [],
    categories: [],
  };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/prompt-cards" && init?.method === "POST") {
      return new Response(JSON.stringify(cardC), { status: 201 });
    }
    if (url.includes("/api/prompt-cards")) {
      return new Response(JSON.stringify({ items: [cardA, cardB] }), { status: 200 });
    }
    if (url.includes("/api/categories")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  const user = userEvent.setup();
  renderLibrary();
  await user.click(await screen.findByRole("button", { name: "新增提示词" }));
  expect(screen.getByRole("dialog", { name: "新增提示词" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("标题"), "新卡片");
  await user.type(screen.getByLabelText("提示词正文"), "新提示词");
  await user.upload(screen.getByLabelText("上传示例图"), new File(["image"], "one.jpg", { type: "image/jpeg" }));
  await user.click(screen.getByRole("button", { name: "保存提示词" }));
  expect(await screen.findByText(cardC.title)).toBeInTheDocument();
});


test("卡片菜单打开编辑抽屉并回填", async () => {
  const user = userEvent.setup();
  renderLibrary();
  await user.click(await screen.findByRole("button", { name: "赛博城市的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "编辑" }));
  expect(screen.getByRole("dialog", { name: "编辑提示词" })).toBeInTheDocument();
  expect(screen.getByLabelText("标题")).toHaveValue("赛博城市");
});
```

- [ ] **步骤 2：运行集成测试并确认入口缺失**

运行：

```powershell
Set-Location frontend
npm test -- src/components/PromptLibraryPage.test.tsx
```

预期：失败，找不到“新增提示词”按钮或卡片操作按钮。

- [ ] **步骤 3：给卡片增加可访问操作菜单**

在 `PromptCardCard.tsx` 增加菜单开关状态。菜单按钮：

```tsx
<button
  type="button"
  className="prompt-card-menu-trigger"
  aria-label={`${card.title}的更多操作`}
  aria-haspopup="menu"
  aria-expanded={menuOpen}
  onClick={() => setMenuOpen((open) => !open)}
>
  ⋯
</button>
```

打开时渲染 `role="menu"`，内部“编辑”“删除”使用 `role="menuitem"`；点击后先关闭菜单再调用对应回调。不得把菜单按钮放入图片预览点击区域。

- [ ] **步骤 4：在提示词库管理抽屉和保存后的列表状态**

在 `PromptLibraryPage` 增加：

```typescript
type EditorState =
  | { mode: "create"; card: null }
  | { mode: "edit"; card: PromptCard }
  | null;

const [editor, setEditor] = useState<EditorState>(null);

const handleSaved = (saved: PromptCard) => {
  setCards((current) => {
    const exists = current.some((card) => card.id === saved.id);
    return exists
      ? current.map((card) => (card.id === saved.id ? saved : card))
      : [saved, ...current];
  });
  setEditor(null);
};
```

工具栏渲染“新增提示词”；卡片回调打开编辑或进入删除；页面末尾条件渲染抽屉。保存后仍通过现有 `filterPromptCards` 计算可见列表，因此当前搜索、分类和排序状态不被重置。

- [ ] **步骤 5：写删除成功、404、409、取消和 401 测试**

先在测试文件增加复用 mock：

```typescript
function mockDeleteResponse(status: number, detail?: string) {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/prompt-cards/2" && init?.method === "DELETE") {
      return status === 204
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ detail }), { status });
    }
    if (url.includes("/api/prompt-cards")) {
      return new Response(JSON.stringify({ items: [cardA, cardB] }), { status: 200 });
    }
    if (url.includes("/api/categories")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  return fetchMock;
}

async function openCyberDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "赛博城市的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除" }));
}
```

再增加：

```typescript
test("取消删除时不发送请求", async () => {
  const fetchMock = mockDeleteResponse(204);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  renderLibrary();
  await openCyberDelete(user);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});


test("删除成功后从列表移除卡片", async () => {
  mockDeleteResponse(204);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  renderLibrary();
  await openCyberDelete(user);
  await waitFor(() => expect(screen.queryByText("赛博城市")).not.toBeInTheDocument());
});


test.each([
  [404, "提示词卡片不存在", "提示词卡片已不存在", false],
  [409, "该提示词存在生成历史，无法删除", "该提示词存在生成历史，无法删除", true],
] as const)("删除错误状态 %s 显示明确反馈", async (status, detail, message, keepsCard) => {
  mockDeleteResponse(status, detail);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  renderLibrary();
  await openCyberDelete(user);
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(Boolean(screen.queryByText("赛博城市"))).toBe(keepsCard);
});
```

401 行为放在 `frontend/src/App.test.tsx` 的登录集成环境验证。先给 `mockAuthedApis` 的 options 增加：

```typescript
cardMutation?: (url: string, method: string) => Promise<Response> | Response;
```

并在 `/api/prompt-cards` 分支读取 cards 之前加入：

```typescript
if (method !== "GET" && options?.cardMutation) {
  return options.cardMutation(url, method);
}
```

然后增加：

```typescript
test("删除提示词返回 401 时回到登录页", async () => {
  mockAuthedApis({
    cards: jsonResponse({ items: [workspaceCardFixture] }),
    cardMutation: () => jsonResponse({ detail: "Unauthorized" }, 401),
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  renderApp();
  await user.type(screen.getByLabelText("密码"), crypto.randomUUID());
  await user.click(screen.getByRole("button", { name: "登录" }));
  await user.click(await screen.findByRole("button", { name: "测试卡片的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除" }));
  expect(await screen.findByLabelText("密码")).toBeInTheDocument();
});
```

确认文案固定为“确定删除这个提示词？删除后无法恢复。”。

- [ ] **步骤 6：实现删除状态与错误提示**

增加 `deletingCardId` 和 `actionError`。处理函数：

```typescript
const handleDelete = async (card: PromptCard) => {
  if (!window.confirm("确定删除这个提示词？删除后无法恢复。")) return;
  setDeletingCardId(card.id);
  setActionError(null);
  try {
    await deletePromptCard(token, card.id);
    setCards((current) => current.filter((item) => item.id !== card.id));
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      clearToken(token);
      return;
    }
    if (error instanceof ApiError && error.status === 404) {
      setCards((current) => current.filter((item) => item.id !== card.id));
      setActionError("提示词卡片已不存在");
    } else {
      setActionError(error instanceof ApiError ? error.message : "删除提示词失败，请稍后重试");
    }
  } finally {
    setDeletingCardId(null);
  }
};
```

错误使用 `role="alert"` 展示。删除中的卡片菜单禁用，防止重复请求。

- [ ] **步骤 7：补充工具栏和卡片菜单样式**

在 `index.css` 中让搜索框占剩余宽度，“新增提示词”保持右侧主按钮；菜单用绝对定位、白色表面、边框和阴影，确保层级高于卡片但低于抽屉。窄屏工具栏允许换行，新增按钮不小于 44 px 高。

- [ ] **步骤 8：运行提示词库、应用壳和构建回归**

运行：

```powershell
npm test -- src/components/PromptLibraryPage.test.tsx src/App.test.tsx
npm run build
```

预期：全部通过；现有“使用此提示词”导航测试仍通过。

- [ ] **步骤 9：提交页面集成**

```powershell
Set-Location ..
git add frontend/src/components/PromptCardCard.tsx frontend/src/components/PromptLibraryPage.tsx frontend/src/components/PromptLibraryPage.test.tsx frontend/src/App.test.tsx frontend/src/index.css
git commit -m "feat: 集成提示词卡片管理流程"
```

---

### 任务 9：补充中文文档并完成全量验证

**文件：**

- 修改：`README.md`
- 验证：`backend/tests/`
- 验证：`frontend/src/**/*.test.tsx`

**接口：**

- 消费：前八个任务的完整功能。
- 产出：用户可执行的中文使用说明和最终验证证据。

- [ ] **步骤 1：更新 README 的网页端管理说明**

在提示词库章节增加“网页端管理提示词卡片”，明确：

```markdown
### 网页端管理提示词卡片

登录后，在提示词库点击“新增提示词”可以填写标题、提示词正文，并从本地批量上传示例图。卡片右上角菜单提供编辑和删除操作。

- 每张卡片必须包含 1 至 20 张 JPG 或 PNG 示例图；
- 单张图片不超过 20 MB，单次新增或编辑上传总量不超过 100 MB；
- 编辑时可以移除、追加和调整图片顺序；
- 已产生生成历史的提示词不能删除，需要先保留该卡片或单独清理关联历史；
- 网页端新建卡片默认不设置分类。
```

- [ ] **步骤 2：运行后端全量测试**

运行：

```powershell
Set-Location backend
python -m pytest -q
```

预期：全部通过，无失败、错误或未处理警告。

- [ ] **步骤 3：运行前端全量测试**

运行：

```powershell
Set-Location ../frontend
npm test
```

预期：全部通过，无失败测试。

- [ ] **步骤 4：运行前端生产构建**

运行：

```powershell
npm run build
```

预期：TypeScript 检查和 Vite 构建成功，输出 `frontend/dist/`。

- [ ] **步骤 5：检查格式、未跟踪文件和差异范围**

运行：

```powershell
Set-Location ..
git diff --check
git status --short
git diff --stat
```

预期：`git diff --check` 无输出；差异只包含本计划列出的产品、测试和 README 文件。忽略用户已有的 `.idea/`、`.superpowers/`、`data/logs/`、`data/tmp-pytest/` 未跟踪内容。

- [ ] **步骤 6：提交 README 和最终修正**

```powershell
git add README.md
git commit -m "docs: 说明提示词卡片网页管理"
```

如果步骤 2 至 5 为修复测试或构建问题修改了其他已纳入本计划的文件，将这些文件与对应测试一起暂存，并使用描述实际修复内容的独立提交，不得把无关未跟踪目录加入提交。

- [ ] **步骤 7：记录最终验收结果**

在交付消息中报告：后端测试数量与结果、前端测试数量与结果、生产构建结果、生成历史删除冲突已验证、工作区中保留但未提交的用户文件。不得在没有刚刚运行上述命令的情况下声称“全部通过”。
