# 图片生成流程实施计划

> **面向执行代理：** 必须逐任务使用 `subagent-driven-development`（推荐）或 `executing-plans` 执行本计划，并用复选框跟踪步骤。受项目 `AGENTS.md` 约束，不得使用名为 `le1` 的 subagent。

**目标：** 让“开始生成”真正串行调用 Gemini Nano Banana 2，并在历史页以单个临时 loading、失败卡片和持久化成功卡片呈现进度。

**架构：** 后端新增一个同步的单张生成接口，内部复用独立 Gemini 原生客户端，成功后才写图片与现有历史表，失败只记文本日志。前端由 `AppShell` 保存当前会话批次并一次只发一张请求，历史页合并临时卡片与现有历史；刷新后只恢复数据库中的成功结果。

**技术栈：** Python 3.12、FastAPI、SQLite、Pillow、Python `logging`、React、TypeScript、Vitest、Testing Library。

## 全局约束

- 所有新增或修改的文档、界面文案和代码注释必须使用中文。
- 不增加任务表、消息队列、独立 worker、定时任务、任务恢复或后端取消接口。
- 后端每次请求只生成一张图片；生成数量完全由前端严格串行调度。
- 当前批次任何时刻最多显示一个 loading；失败卡片只存在当前浏览器会话。
- 新批次使旧批次停止后续调度，但旧批次已经发出的请求允许完成并写入历史。
- Gemini 默认 Base URL 为 `https://gemini.xyz365.tech/v1beta`，默认模型为 `gemini-3.1-flash-image`。
- “低 / 高”分别映射为 `minimal / high`；`Auto` 比例不发送 `aspectRatio`。
- 单次请求只对 429、5xx 和无效图片响应最多尝试 3 次；失败卡片不自动重新生成。
- 自动测试不得调用真实 Gemini。

## 文件结构

- 新建 `backend/app/gemini_image_generator.py`：构造 Gemini 原生请求、HTTP 传输、图片提取与有限重试。
- 新建 `backend/app/routes/generations.py`：解析单张生成表单、调用 Gemini、原子写图片、写历史和记录错误日志。
- 新建 `backend/tests/test_gemini_image_generator.py`：覆盖 Gemini 请求和重试规则。
- 新建 `backend/tests/test_generation_routes.py`：覆盖单张生成接口、文件/历史写入和失败日志。
- 修改 `backend/app/config.py`：增加 Gemini 配置。
- 修改 `backend/app/main.py`：挂载生成路由、注入生成函数并配置文本日志。
- 修改 `backend/app/routes/generation_history.py`：公开历史响应转换函数供生成路由复用。
- 修改 `backend/requirements.txt`：加入 Pillow 与 multipart 表单解析依赖。
- 新建 `frontend/src/generation.ts`：定义工作台提交参数和当前会话卡片类型。
- 新建 `frontend/src/api.test.ts`：验证单张生成请求的 multipart 内容。
- 修改 `frontend/src/api.ts`：增加单张生成请求。
- 修改 `frontend/src/components/GenerationWorkspacePage.tsx`：保留参考图 `File`、改为低/高思考级别并向父组件提交。
- 修改 `frontend/src/components/AppShell.tsx`：持有批次、执行串行调度、终止旧批次并跳转历史页。
- 修改 `frontend/src/components/GenerationHistoryPage.tsx`：合并、筛选、排序和渲染临时卡片。
- 修改 `frontend/src/index.css`：增加 loading 与失败卡片样式。
- 修改相关前端测试：覆盖提交契约、串行调度、旧批次终止和历史临时状态。
- 修改 `.env.example` 与 `README.md`：记录 Gemini 配置、运行行为和日志路径。

---

### Task 1：Gemini 原生图片客户端

**文件：**
- 新建：`backend/tests/test_gemini_image_generator.py`
- 新建：`backend/app/gemini_image_generator.py`
- 修改：`backend/requirements.txt`

**接口：**
- 产出：`ReferenceImage(mime_type: str, data: bytes)`。
- 产出：`GeneratedImage(data: bytes, mime_type: str)`。
- 产出：`build_generation_request(...) -> dict[str, Any]`。
- 产出：`generate_image(...) -> GeneratedImage`，供 Task 2 的路由调用。

- [ ] **Step 1：先加入运行依赖**

在 `backend/requirements.txt` 追加：

```text
Pillow>=11,<12
python-multipart>=0.0.20,<1
```

- [ ] **Step 2：编写请求体和图片提取的失败测试**

创建 `backend/tests/test_gemini_image_generator.py`，先写以下测试和辅助函数：

```python
import base64
import io

from PIL import Image
import pytest

from app.gemini_image_generator import (
    GeneratedImage,
    GeminiImageError,
    ReferenceImage,
    build_generation_request,
    extract_image,
)


def png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "#123456").save(output, format="PNG")
    return output.getvalue()


def image_response(raw: bytes, mime_type: str = "image/png") -> dict:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": base64.b64encode(raw).decode("ascii"),
                            }
                        }
                    ]
                }
            }
        ]
    }


def test_build_generation_request_maps_parameters_and_references() -> None:
    request = build_generation_request(
        prompt="画一座雨夜城市",
        references=[ReferenceImage("image/png", b"reference")],
        aspect_ratio="16:9",
        resolution="2K",
        thinking_level="high",
    )

    parts = request["contents"][0]["parts"]
    assert parts[0] == {"text": "画一座雨夜城市"}
    assert parts[1]["inlineData"]["mimeType"] == "image/png"
    assert base64.b64decode(parts[1]["inlineData"]["data"]) == b"reference"
    assert request["generationConfig"] == {
        "responseModalities": ["IMAGE"],
        "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"},
        "thinkingConfig": {"thinkingLevel": "high"},
    }


def test_build_generation_request_omits_auto_aspect_ratio() -> None:
    request = build_generation_request(
        prompt="自由构图",
        references=[],
        aspect_ratio="Auto",
        resolution="1K",
        thinking_level="minimal",
    )

    assert request["generationConfig"]["imageConfig"] == {"imageSize": "1K"}


def test_extract_image_accepts_png_and_rejects_invalid_data() -> None:
    raw = png_bytes()
    assert extract_image(image_response(raw)) == GeneratedImage(raw, "image/png")

    with pytest.raises(GeminiImageError, match="图片"):
        extract_image(image_response(b"not-an-image"))
```

- [ ] **Step 3：运行测试并确认红灯原因正确**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_gemini_image_generator.py -q
```

预期：测试收集失败，提示 `app.gemini_image_generator` 不存在。

- [ ] **Step 4：实现请求构造和图片提取**

创建 `backend/app/gemini_image_generator.py`，实现以下完整基础结构：

```python
from __future__ import annotations

import base64
import binascii
import io
from dataclasses import dataclass
from typing import Any

from PIL import Image, UnidentifiedImageError


class GeminiImageError(RuntimeError):
    """Gemini 图片请求或响应无效。"""


class GeminiHttpError(GeminiImageError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


@dataclass(frozen=True)
class ReferenceImage:
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class GeneratedImage:
    data: bytes
    mime_type: str


def build_generation_request(
    *,
    prompt: str,
    references: list[ReferenceImage],
    aspect_ratio: str,
    resolution: str,
    thinking_level: str,
) -> dict[str, Any]:
    image_config = {"imageSize": resolution}
    if aspect_ratio != "Auto":
        image_config["aspectRatio"] = aspect_ratio
    parts: list[dict[str, Any]] = [{"text": prompt}]
    parts.extend(
        {
            "inlineData": {
                "mimeType": reference.mime_type,
                "data": base64.b64encode(reference.data).decode("ascii"),
            }
        }
        for reference in references
    )
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": image_config,
            "thinkingConfig": {"thinkingLevel": thinking_level},
        },
    }


def extract_image(response: dict[str, Any]) -> GeneratedImage:
    candidates = response.get("candidates")
    if not isinstance(candidates, list):
        raise GeminiImageError("Gemini 没有返回图片")
    for candidate in candidates:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData", part.get("inline_data"))
            if not isinstance(inline, dict):
                continue
            mime_type = inline.get("mimeType", inline.get("mime_type"))
            encoded = inline.get("data")
            if mime_type not in {"image/png", "image/jpeg"} or not isinstance(encoded, str):
                continue
            try:
                raw = base64.b64decode(encoded, validate=True)
                with Image.open(io.BytesIO(raw)) as image:
                    image.verify()
            except (binascii.Error, ValueError, OSError, UnidentifiedImageError) as error:
                raise GeminiImageError("Gemini 返回的图片无效") from error
            if not raw:
                raise GeminiImageError("Gemini 返回了空图片")
            return GeneratedImage(raw, mime_type)
    raise GeminiImageError("Gemini 没有返回图片")
```

- [ ] **Step 5：运行基础测试并确认绿灯**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_gemini_image_generator.py -q
```

预期：3 个测试通过。

- [ ] **Step 6：编写 HTTP 与有限重试的失败测试**

在同一测试文件追加：

```python
from app.gemini_image_generator import GeminiHttpError, generate_image


def test_generate_image_builds_native_url_and_bearer_header() -> None:
    calls = []

    def transport(url, headers, payload, timeout):
        calls.append((url, headers, payload, timeout))
        return image_response(png_bytes())

    result = generate_image(
        api_key="secret",
        base_url="https://example.test/v1beta/",
        model="gemini-3.1-flash-image",
        prompt="生成图片",
        references=[],
        aspect_ratio="Auto",
        resolution="1K",
        thinking_level="minimal",
        transport=transport,
        sleeper=lambda _: None,
    )

    assert result.mime_type == "image/png"
    assert calls[0][0] == (
        "https://example.test/v1beta/models/"
        "gemini-3.1-flash-image:generateContent"
    )
    assert calls[0][1]["Authorization"] == "Bearer secret"


@pytest.mark.parametrize(
    "first_failure",
    [
        GeminiHttpError(429, "busy"),
        GeminiHttpError(503, "unavailable"),
        image_response(b"invalid"),
    ],
)
def test_generate_image_retries_retryable_failures(first_failure, caplog) -> None:
    attempts = []
    sleeps = []

    def transport(url, headers, payload, timeout):
        attempts.append(url)
        if len(attempts) == 1:
            if isinstance(first_failure, Exception):
                raise first_failure
            return first_failure
        return image_response(png_bytes())

    with caplog.at_level("WARNING", logger="app.generation"):
        generate_image(
            api_key="secret",
            base_url="https://example.test/v1beta",
            model="gemini-3.1-flash-image",
            prompt="生成图片",
            references=[],
            aspect_ratio="1:1",
            resolution="1K",
            thinking_level="high",
            transport=transport,
            sleeper=sleeps.append,
        )

    assert len(attempts) == 2
    assert sleeps == [1.0]
    assert "attempt=1" in caplog.text


def test_generate_image_does_not_retry_non_retryable_4xx() -> None:
    attempts = []

    def transport(url, headers, payload, timeout):
        attempts.append(url)
        raise GeminiHttpError(401, "bad key")

    with pytest.raises(GeminiHttpError):
        generate_image(
            api_key="secret",
            base_url="https://example.test/v1beta",
            model="gemini-3.1-flash-image",
            prompt="生成图片",
            references=[],
            aspect_ratio="1:1",
            resolution="1K",
            thinking_level="minimal",
            transport=transport,
            sleeper=lambda _: pytest.fail("401 不应等待重试"),
        )

    assert len(attempts) == 1
```

- [ ] **Step 7：运行新增测试并确认红灯**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_gemini_image_generator.py -q
```

预期：测试因 `generate_image` 尚未定义而失败。

- [ ] **Step 8：实现 HTTP 传输和重试**

在 `backend/app/gemini_image_generator.py` 增加以下 import：

```python
import json
import logging
import time
from typing import Callable, TypeAlias
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
```

在异常类型前创建模块 logger：

```python
logger = logging.getLogger("app.generation")
```

再增加标准库 HTTP 传输：

```python
Transport: TypeAlias = Callable[
    [str, dict[str, str], dict[str, Any], float],
    dict[str, Any],
]


def _safe_error_message(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return "服务端未提供错误信息"
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text[:500]
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"][:500]
    return text[:500]


def http_post_json(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as error:
        try:
            error_body = error.read()
        except OSError:
            error_body = b""
        raise GeminiHttpError(
            int(error.code),
            _safe_error_message(error_body),
        ) from error
    except URLError as error:
        raise GeminiImageError(f"Gemini 网络请求失败：{error.reason}") from error
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GeminiImageError("Gemini 响应不是有效 JSON") from error
    if not isinstance(decoded, dict):
        raise GeminiImageError("Gemini JSON 响应顶层不是对象")
    return decoded
```

最后增加 `generate_image`：

```python
Transport = Callable[[str, dict[str, str], dict[str, Any], float], dict[str, Any]]


def generate_image(
    *,
    api_key: str,
    base_url: str,
    model: str,
    prompt: str,
    references: list[ReferenceImage],
    aspect_ratio: str,
    resolution: str,
    thinking_level: str,
    transport: Transport = http_post_json,
    sleeper: Callable[[float], None] = time.sleep,
    timeout: float = 180.0,
    max_attempts: int = 3,
) -> GeneratedImage:
    encoded_model = quote(model, safe="-.()")
    url = f"{base_url.rstrip('/')}/models/{encoded_model}:generateContent"
    headers = {"Authorization": f"Bearer {api_key}"}
    payload = build_generation_request(
        prompt=prompt,
        references=references,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        thinking_level=thinking_level,
    )
    for attempt in range(1, max_attempts + 1):
        try:
            return extract_image(transport(url, headers, payload, timeout))
        except GeminiHttpError as error:
            retryable = error.status == 429 or error.status >= 500
            if not retryable or attempt == max_attempts:
                raise
        except GeminiImageError:
            if attempt == max_attempts:
                raise
        logger.warning(
            "Gemini 图片请求准备重试 attempt=%s max_attempts=%s model=%s",
            attempt,
            max_attempts,
            model,
        )
        sleeper(float(attempt))
    raise GeminiImageError("Gemini 图片生成失败")
```

错误消息最多保留服务端文本前 500 个字符，且不能拼入 Authorization 头。

- [ ] **Step 9：运行 Task 1 测试**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_gemini_image_generator.py -q
```

预期：8 个测试全部通过（含 3 个可重试失败参数组合）。

- [ ] **Step 10：提交 Task 1**

```powershell
git add backend/requirements.txt backend/app/gemini_image_generator.py backend/tests/test_gemini_image_generator.py
git commit -m "feat: 增加 Gemini 图片生成客户端"
```

---

### Task 2：单张生成 API、文件写入与日志

**文件：**
- 新建：`backend/tests/test_generation_routes.py`
- 新建：`backend/app/routes/generations.py`
- 修改：`backend/app/config.py`
- 修改：`backend/app/main.py`
- 修改：`backend/app/routes/generation_history.py`

**接口：**
- 消费：Task 1 的 `ReferenceImage`、`GeneratedImage`、`GeminiImageError`、`generate_image`。
- 产出：`POST /api/generations`，multipart 输入，成功返回 `GenerationHistoryItem`。
- 产出：`to_generation_history_item(history) -> GenerationHistoryItem`。

- [ ] **Step 1：编写成功生成接口的失败测试**

创建 `backend/tests/test_generation_routes.py`，先加入 fixture 与辅助函数：

```python
import io
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.auth import hash_password
from app.config import Settings
from app.gemini_image_generator import GeneratedImage, GeminiImageError
from app.main import create_app
from app.prompt_card_repository import PromptCardRepository

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


@pytest.fixture
def password() -> str:
    return "generation-route-password"


@pytest.fixture
def png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "#123456").save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def generation_client(password: str, tmp_path: Path) -> TestClient:
    data_root = tmp_path / "data"
    data_root.mkdir()
    image_directory = data_root / "prompt-images"
    image_directory.mkdir()
    database_path = data_root / "app.db"
    connection = sqlite3.connect(database_path)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    PromptCardRepository(connection).create_prompt_card(
        title="测试卡",
        prompt_text="测试提示词",
        example_image_path="prompt-images/example.png",
    )
    connection.close()
    settings = Settings(
        auth_password_hash=hash_password(password),
        database_path=database_path,
        image_directory=image_directory,
        gemini_api_key="secret",
    )
    return TestClient(create_app(settings))


def login(client: TestClient, password: str) -> str:
    response = client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 200
    return response.json()["token"]
```

随后加入成功路径测试：

```python
def test_create_generation_writes_image_and_history(generation_client, password, png_bytes):
    captured = {}

    def fake_generator(**kwargs):
        captured.update(kwargs)
        return GeneratedImage(png_bytes, "image/png")

    generation_client.app.state.image_generator = fake_generator
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "prompt_card_id": "1",
            "prompt": "生成雨夜城市",
            "model": "Nano Banana 2",
            "aspect_ratio": "16:9",
            "resolution": "2K",
            "thinking_level": "high",
        },
        files=[
            ("reference_images", ("ref.png", png_bytes, "image/png")),
        ],
    )

    assert response.status_code == 201
    body = response.json()
    assert body["prompt_card_id"] == 1
    assert body["model"] == "Nano Banana 2"
    assert body["aspect_ratio"] == "16:9"
    assert body["resolution"] == "2K"
    assert body["image_path"].startswith("generated-images/")
    assert generation_client.app.state.generated_image_directory.joinpath(
        Path(body["image_path"]).name
    ).is_file()
    assert captured["prompt"] == "生成雨夜城市"
    assert captured["references"][0].mime_type == "image/png"
    assert captured["thinking_level"] == "high"

    listed = generation_client.get(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert [item["id"] for item in listed.json()["items"]] == [body["id"]]
```

再加入固定表单 helper 与四个边界测试：

```python
def generation_form(prompt_card_id: str = "1") -> dict[str, str]:
    return {
        "prompt_card_id": prompt_card_id,
        "prompt": "生成图片",
        "model": "Nano Banana 2",
        "aspect_ratio": "Auto",
        "resolution": "1K",
        "thinking_level": "minimal",
    }


def test_generation_requires_login(generation_client) -> None:
    assert generation_client.post(
        "/api/generations",
        data=generation_form(),
    ).status_code == 401


def test_generation_requires_api_key(generation_client, password) -> None:
    generation_client.app.state.settings.gemini_api_key = ""
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data=generation_form(),
    )
    assert response.status_code == 503


def test_generation_rejects_more_than_eight_references(
    generation_client, password, png_bytes
) -> None:
    token = login(generation_client, password)
    files = [
        ("reference_images", (f"ref-{index}.png", png_bytes, "image/png"))
        for index in range(9)
    ]
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data=generation_form(),
        files=files,
    )
    assert response.status_code == 422


def test_generation_rejects_missing_prompt_card(
    generation_client, password
) -> None:
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data=generation_form("999"),
    )
    assert response.status_code == 404
```

- [ ] **Step 2：运行路由测试并确认红灯**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_generation_routes.py -q
```

预期：请求返回 404，因为 `/api/generations` 尚未挂载。

- [ ] **Step 3：增加配置和公开历史转换函数**

在 `Settings` 增加：

```python
gemini_api_key: str = ""
gemini_base_url: str = "https://gemini.xyz365.tech/v1beta"
gemini_model: str = "gemini-3.1-flash-image"
```

把 `backend/app/routes/generation_history.py` 的 `_to_item` 改名为：

```python
def to_generation_history_item(history: GenerationHistory) -> GenerationHistoryItem:
```

并替换该文件内全部 `_to_item(...)` 调用。

- [ ] **Step 4：实现生成路由**

创建 `backend/app/routes/generations.py`，先定义常量和辅助函数：

```python
from __future__ import annotations

import logging
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status

from app.gemini_image_generator import GeminiImageError, ReferenceImage
from app.generation_history_repository import GenerationHistoryRepository
from app.prompt_card_repository import PromptCardRepository
from app.routes.auth import require_token
from app.routes.generation_history import (
    GenerationHistoryItem,
    to_generation_history_item,
)

router = APIRouter(prefix="/generations", tags=["generations"])
logger = logging.getLogger("app.generation")

ASPECT_RATIOS = {
    "Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3",
    "5:4", "4:5", "21:9", "4:1", "1:4", "8:1", "1:8",
}
RESOLUTIONS = {"1K", "2K"}
THINKING_LEVELS = {"minimal", "high"}
REFERENCE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
OUTPUT_SUFFIXES = {"image/png": ".png", "image/jpeg": ".jpg"}


def read_references(uploads: list[UploadFile]) -> list[ReferenceImage]:
    if len(uploads) > 8:
        raise HTTPException(status_code=422, detail="最多上传 8 张参考图")
    references = []
    for upload in uploads:
        mime_type = upload.content_type or ""
        if mime_type not in REFERENCE_MIME_TYPES:
            raise HTTPException(status_code=422, detail="不支持的参考图格式")
        data = upload.file.read()
        if not data:
            raise HTTPException(status_code=422, detail="参考图不能为空")
        references.append(ReferenceImage(mime_type=mime_type, data=data))
    return references


def write_generated_image(
    generated_directory: Path,
    data: bytes,
    mime_type: str,
) -> tuple[Path, str]:
    suffix = OUTPUT_SUFFIXES.get(mime_type)
    if suffix is None:
        raise GeminiImageError("Gemini 返回了不支持的图片格式")
    generated_directory.mkdir(parents=True, exist_ok=True)
    filename = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:12]}{suffix}"
    final_path = generated_directory / filename
    with tempfile.NamedTemporaryFile(
        mode="wb",
        delete=False,
        dir=generated_directory,
        suffix=".tmp",
    ) as temporary:
        temporary.write(data)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, final_path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise
    return final_path, f"generated-images/{filename}"
```

随后实现完整路由主体：

1. 使用 `Form` 接收六个标量字段，使用 `File` 接收 `list[UploadFile]`。
2. 验证提示词非空、参考图最多 8 张、MIME 属于 `image/png`、`image/jpeg`、`image/webp`。
3. 查询提示词卡片存在后调用 `request.app.state.image_generator`。
4. 使用 `tempfile.NamedTemporaryFile(delete=False, dir=generated_dir)` 写临时文件，再用 `os.replace` 原子落盘。
5. PNG 使用 `.png`，JPEG 使用 `.jpg`；相对路径固定为 `generated-images/<文件名>`。
6. 写入 `GenerationHistoryRepository` 后用 `to_generation_history_item` 返回。
7. Gemini、磁盘或数据库异常用 `logger.exception` 写日志并返回 502；数据库失败时删除本次最终图片。

路由签名固定为：

```python
@router.post("", response_model=GenerationHistoryItem, status_code=201)
def create_generation(
    request: Request,
    prompt_card_id: int = Form(..., ge=1),
    prompt: str = Form(..., min_length=1),
    model: str = Form(...),
    aspect_ratio: str = Form(...),
    resolution: str = Form(...),
    thinking_level: str = Form(...),
    reference_images: list[UploadFile] = File(default=[]),
    _: str = Depends(require_token),
) -> GenerationHistoryItem:
    settings = request.app.state.settings
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="尚未配置 GEMINI_API_KEY")
    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        raise HTTPException(status_code=422, detail="提示词不能为空")
    if aspect_ratio not in ASPECT_RATIOS:
        raise HTTPException(status_code=422, detail="不支持的图片比例")
    if resolution not in RESOLUTIONS:
        raise HTTPException(status_code=422, detail="不支持的分辨率")
    if thinking_level not in THINKING_LEVELS:
        raise HTTPException(status_code=422, detail="不支持的思考级别")

    references = read_references(reference_images)
    connection = sqlite3.connect(settings.database_path)
    final_path: Path | None = None
    try:
        if PromptCardRepository(connection).get_prompt_card(prompt_card_id) is None:
            raise HTTPException(status_code=404, detail="Prompt card not found")
        generated = request.app.state.image_generator(
            api_key=settings.gemini_api_key,
            base_url=settings.gemini_base_url,
            model=settings.gemini_model,
            prompt=normalized_prompt,
            references=references,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            thinking_level=thinking_level,
        )
        final_path, image_path = write_generated_image(
            request.app.state.generated_image_directory,
            generated.data,
            generated.mime_type,
        )
        repository = GenerationHistoryRepository(connection)
        history_id = repository.create_history(
            prompt_card_id=prompt_card_id,
            image_path=image_path,
            model=model,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
        )
        history = repository.get_history(history_id)
        if history is None:
            raise RuntimeError("生成历史写入后无法读取")
        return to_generation_history_item(history)
    except HTTPException:
        raise
    except (GeminiImageError, OSError, sqlite3.Error, RuntimeError) as error:
        if final_path is not None:
            final_path.unlink(missing_ok=True)
        logger.exception(
            "图片生成失败 prompt_card_id=%s model=%s aspect_ratio=%s "
            "resolution=%s thinking_level=%s error=%s",
            prompt_card_id,
            settings.gemini_model,
            aspect_ratio,
            resolution,
            thinking_level,
            error,
        )
        raise HTTPException(status_code=502, detail="图片生成失败，请查看后台日志") from error
    finally:
        connection.close()
```

- [ ] **Step 5：挂载路由并配置文本日志**

在 `backend/app/main.py`：

- 导入 `logging`、`Path`、Task 1 的 `generate_image` 和新路由。
- 为 logger `app.generation` 增加 UTF-8 `FileHandler`，路径为 `database_path.parent / "logs" / "app.log"`。
- 用 handler 上的自定义属性记录绝对日志路径，避免同一路径重复添加 handler。
- 设置 `application.state.image_generator = generate_image`。
- 设置 `application.state.generated_image_directory = database_path.parent / "generated-images"`。
- 设置 `application.state.generation_log_path = database_path.parent / "logs" / "app.log"`，并把该路径传给 `configure_generation_logging`。
- 以 `/api` 前缀挂载 generation router。

日志配置函数使用以下签名：

```python
def configure_generation_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("app.generation")
    logger.setLevel(logging.INFO)
    resolved = str(log_path.resolve())
    if any(getattr(handler, "generation_log_path", None) == resolved for handler in logger.handlers):
        return
    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.generation_log_path = resolved
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logger.addHandler(handler)
```

- [ ] **Step 6：运行成功路径测试并确认绿灯**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_generation_routes.py tests/test_generation_history_routes.py -q
```

预期：新路由与既有历史路由测试全部通过。

- [ ] **Step 7：编写失败不落库且写日志的失败测试**

在 `backend/tests/test_generation_routes.py` 追加：

```python
def test_generation_failure_writes_log_without_history(generation_client, password):
    def failing_generator(**kwargs):
        raise GeminiImageError("上游没有返回图片")

    generation_client.app.state.image_generator = failing_generator
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "prompt_card_id": "1",
            "prompt": "失败请求",
            "model": "Nano Banana 2",
            "aspect_ratio": "Auto",
            "resolution": "1K",
            "thinking_level": "minimal",
        },
    )

    assert response.status_code == 502
    listed = generation_client.get(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listed.json() == {"items": []}
    log_text = generation_client.app.state.generation_log_path.read_text(
        encoding="utf-8"
    )
    assert "prompt_card_id=1" in log_text
    assert "上游没有返回图片" in log_text
    assert "secret" not in log_text
```

- [ ] **Step 8：运行失败测试并补齐日志上下文**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_generation_routes.py::test_generation_failure_writes_log_without_history -q
```

预期首次运行因日志缺少卡片 ID 或未刷新 handler 而失败。修改路由异常日志为参数化消息，测试读取前对所有匹配 `generation_log_path` 的 handler 执行 `flush()`，再运行至通过。

- [ ] **Step 9：提交 Task 2**

```powershell
git add backend/app/config.py backend/app/main.py backend/app/routes/generation_history.py backend/app/routes/generations.py backend/tests/test_generation_routes.py
git commit -m "feat: 增加单张图片生成接口"
```

---

### Task 3：前端生成请求与工作台提交契约

**文件：**
- 新建：`frontend/src/generation.ts`
- 新建：`frontend/src/api.test.ts`
- 修改：`frontend/src/api.ts`
- 修改：`frontend/src/components/GenerationWorkspacePage.tsx`
- 修改：`frontend/src/components/GenerationWorkspacePage.test.tsx`

**接口：**
- 产出：`GenerationSubmission`，由工作台交给 Task 4 的 `AppShell`。
- 产出：`SessionGenerationCard`，由 Task 4 生产、Task 5 消费。
- 产出：`generateImage(token, request) -> Promise<GenerationHistoryItem>`。

- [ ] **Step 1：定义共享前端类型**

创建 `frontend/src/generation.ts`：

```typescript
import type { GenerationHistoryItem, PromptCard } from "./api";

export type AspectRatio =
  | "Auto" | "1:1" | "9:16" | "16:9" | "3:4" | "4:3"
  | "3:2" | "2:3" | "5:4" | "4:5" | "21:9" | "4:1"
  | "1:4" | "8:1" | "1:8";

export type GenerationSubmission = {
  card: PromptCard;
  prompt: string;
  model: "Nano Banana 2";
  aspectRatio: AspectRatio;
  resolution: "1K" | "2K";
  quantity: 1 | 2 | 4;
  thinkingLevel: "minimal" | "high";
  referenceImages: File[];
};

export type SessionGenerationCard = {
  clientId: string;
  batchId: number;
  status: "loading" | "failed" | "completed";
  promptCardId: number;
  title: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  createdAtMs: number;
  sequence: number;
  history?: GenerationHistoryItem;
};
```

- [ ] **Step 2：编写 API FormData 的失败测试**

在 `frontend/src/api.test.ts` 新增测试，mock `fetch` 并调用 `generateImage`，断言：

```typescript
expect(fetchMock).toHaveBeenCalledWith(
  "/api/generations",
  expect.objectContaining({
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: expect.any(FormData),
  }),
);
const body = fetchMock.mock.calls[0][1]?.body as FormData;
expect(body.get("prompt_card_id")).toBe("9");
expect(body.get("prompt")).toBe("最终提示词");
expect(body.get("thinking_level")).toBe("high");
expect(body.getAll("reference_images")).toEqual([referenceFile]);
```

- [ ] **Step 3：运行 API 测试并确认红灯**

运行：

```powershell
Set-Location frontend
npm test -- src/api.test.ts
```

预期：因 `generateImage` 未导出而失败。

- [ ] **Step 4：实现 `generateImage`**

在 `frontend/src/api.ts` 导出：

```typescript
export type GenerateImageRequest = {
  prompt_card_id: number;
  prompt: string;
  model: string;
  aspect_ratio: string;
  resolution: string;
  thinking_level: "minimal" | "high";
  reference_images: File[];
};

export async function generateImage(
  token: string,
  request: GenerateImageRequest,
): Promise<GenerationHistoryItem> {
  const body = new FormData();
  body.set("prompt_card_id", String(request.prompt_card_id));
  body.set("prompt", request.prompt);
  body.set("model", request.model);
  body.set("aspect_ratio", request.aspect_ratio);
  body.set("resolution", request.resolution);
  body.set("thinking_level", request.thinking_level);
  request.reference_images.forEach((file) => body.append("reference_images", file));
  const response = await fetch("/api/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  return parseResponse<GenerationHistoryItem>(response);
}
```

- [ ] **Step 5：编写工作台提交内容的失败测试**

修改 `renderWorkspace` 接受 `onGenerate = vi.fn()`。替换原“本地提交反馈”测试，验证上传文件、选择参数并点击后：

```typescript
expect(onGenerate).toHaveBeenCalledWith({
  card,
  prompt: "新的提示词",
  model: "Nano Banana 2",
  aspectRatio: "9:16",
  resolution: "2K",
  quantity: 4,
  thinkingLevel: "high",
  referenceImages: [referenceFile],
});
expect(screen.queryByText("已创建本地生成任务（演示）")).not.toBeInTheDocument();
```

并把参数测试期望更新为：默认思考级别 `minimal`，选项值 `minimal`、`high`，显示文字为“低”“高”。

- [ ] **Step 6：运行工作台测试并确认红灯**

运行：

```powershell
Set-Location frontend
npm test -- src/components/GenerationWorkspacePage.test.tsx
```

预期：`onGenerate` prop 不存在，且思考级别仍包含“中等”。

- [ ] **Step 7：实现工作台提交**

修改组件 props：

```typescript
export type GenerationWorkspacePageProps = {
  card: PromptCard;
  onBack: () => void;
  onGenerate: (submission: GenerationSubmission) => void;
};
```

`ReferenceImage` 增加 `file: File`；上传时同时保存 `file`、`name`、`url`。删除 `submitted` 状态与演示反馈。思考级别 select 改为：

```tsx
<option value="minimal">低</option>
<option value="high">高</option>
```

提交按钮调用：

```typescript
onGenerate({
  card,
  prompt: prompt.trim(),
  model: generationParams.model,
  aspectRatio: generationParams.aspectRatio,
  resolution: generationParams.resolution,
  quantity: Number(generationParams.quantity) as 1 | 2 | 4,
  thinkingLevel: generationParams.thinkingLevel,
  referenceImages: referenceImages.map((image) => image.file),
});
```

- [ ] **Step 8：运行 Task 3 前端测试**

运行：

```powershell
Set-Location frontend
npm test -- src/api.test.ts src/components/GenerationWorkspacePage.test.tsx
```

预期：API 与工作台测试全部通过。

- [ ] **Step 9：提交 Task 3**

```powershell
git add frontend/src/generation.ts frontend/src/api.ts frontend/src/api.test.ts frontend/src/components/GenerationWorkspacePage.tsx frontend/src/components/GenerationWorkspacePage.test.tsx
git commit -m "feat: 提交单张图片生成请求"
```

---

### Task 4：AppShell 串行批次调度

**文件：**
- 修改：`frontend/src/components/AppShell.tsx`
- 修改：`frontend/src/App.test.tsx`

**接口：**
- 消费：Task 3 的 `GenerationSubmission`、`SessionGenerationCard` 和 `generateImage`。
- 产出：向 Task 5 的 `GenerationHistoryPage` 传递 `initialPromptCardId` 与 `sessionCards`。

- [ ] **Step 1：扩展测试 fetch mock**

让 `mockAuthedApis` 接受：

```typescript
generations?: () => Promise<Response>;
```

在 mock 中把 `POST /api/generations` 路由到该函数。增加 `generationResponse(id, promptCardId, createdAt)`，返回完整 `GenerationHistoryItem` JSON。

- [ ] **Step 2：编写单 loading 串行调度的失败测试**

在 `frontend/src/App.test.tsx` 新增测试：登录、进入卡片 9 的工作台、选择数量 2 后开始生成。第一次生成使用 deferred response。断言：

```typescript
expect(await screen.findByRole("heading", { name: "生成历史" })).toBeInTheDocument();
expect(screen.getByLabelText("提示词卡片筛选")).toHaveValue("9");
expect(screen.getAllByText("生成中")).toHaveLength(1);
expect(generationCalls).toBe(1);
```

解析第一次 deferred 后，等待第二次调用并再次断言只有一个“生成中”；解析第二次后断言“生成中”消失且两张完成卡片出现。

- [ ] **Step 3：运行串行测试并确认红灯**

运行：

```powershell
Set-Location frontend
npm test -- src/App.test.tsx
```

预期：工作台提交后没有跳转历史页，也没有生成请求。

- [ ] **Step 4：实现批次状态与串行循环**

在 `AppShell` 增加：

```typescript
const activeBatchIdRef = useRef(0);
const [sessionCards, setSessionCards] = useState<SessionGenerationCard[]>([]);
```

`AppView` 的 history 变体改为：

```typescript
| { name: "history"; promptCardId: number | null };
```

从 `useAuth()` 取得 `clearToken`，然后实现完整 `runBatch`。循环中每次先确认 `activeBatchIdRef.current === batchId`，再创建唯一 loading 并调用 `generateImage`：

```typescript
const runBatch = async (
  batchId: number,
  submission: GenerationSubmission,
) => {
  for (let sequence = 0; sequence < submission.quantity; sequence += 1) {
    if (activeBatchIdRef.current !== batchId) {
      return;
    }
    const loadingCard: SessionGenerationCard = {
      clientId: crypto.randomUUID(),
      batchId,
      status: "loading",
      promptCardId: submission.card.id,
      title: submission.card.title,
      model: submission.model,
      aspectRatio: submission.aspectRatio,
      resolution: submission.resolution,
      createdAtMs: Date.now(),
      sequence,
    };
    setSessionCards((current) => [loadingCard, ...current]);
    try {
      const history = await generateImage(token, {
        prompt_card_id: submission.card.id,
        prompt: submission.prompt,
        model: submission.model,
        aspect_ratio: submission.aspectRatio,
        resolution: submission.resolution,
        thinking_level: submission.thinkingLevel,
        reference_images: submission.referenceImages,
      });
      setSessionCards((current) => {
        const completed: SessionGenerationCard = {
          ...loadingCard,
          status: "completed",
          createdAtMs: Date.now(),
          history,
        };
        return current.some((item) => item.clientId === loadingCard.clientId)
          ? current.map((item) =>
              item.clientId === loadingCard.clientId ? completed : item,
            )
          : [completed, ...current];
      });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        clearToken(token);
        return;
      }
      setSessionCards((current) =>
        current.map((item) =>
          item.clientId === loadingCard.clientId
            ? { ...item, status: "failed" }
            : item,
        ),
      );
    }
    if (activeBatchIdRef.current !== batchId) {
      return;
    }
  }
};
```

失败只把仍存在的 loading 改为 failed，因此被新批次移除的旧 loading 不会以失败状态重新出现。每次请求返回后再次检查 batch ID，保证旧批次不得进入下一轮。

实现 `startGeneration(submission)`：

```typescript
const batchId = activeBatchIdRef.current + 1;
activeBatchIdRef.current = batchId;
setSessionCards((current) => current.filter((item) => item.status !== "loading"));
setView({ name: "history", promptCardId: submission.card.id });
void runBatch(batchId, submission);
```

工作台传入 `onGenerate={startGeneration}`；顶部“历史”传入 `promptCardId: null`。

- [ ] **Step 5：运行串行测试并确认绿灯**

运行：

```powershell
Set-Location frontend
npm test -- src/App.test.tsx
```

预期：新串行测试通过，既有导航和登录测试不回归。

- [ ] **Step 6：编写终止旧批次的失败测试**

新增测试：旧批次数量选择 2，保持第一次请求 pending；通过顶部导航返回提示词库，再次进入工作台并开始新批次。断言第二个请求已发出、页面仍只有一个 loading。随后解析旧请求并断言：

```typescript
await waitFor(() => expect(generationCalls).toBe(2));
expect(screen.getAllByText("生成中")).toHaveLength(1);
oldRequest.resolve(generationResponse(41, 9, 1723000000));
await waitFor(() => expect(screen.getByText("测试卡片")).toBeInTheDocument());
expect(generationCalls).toBe(2);
```

这证明旧请求成功可显示，但不会调度旧批次第二张。

- [ ] **Step 7：运行终止测试并修正竞态**

运行：

```powershell
Set-Location frontend
npm test -- src/App.test.tsx
```

预期首次运行暴露旧请求结果丢失或继续调度。按 Step 4 的“找不到旧 loading 时把 completed 插到列表头；返回后先检查 batch ID”规则修正，直到通过。

- [ ] **Step 8：提交 Task 4**

```powershell
git add frontend/src/components/AppShell.tsx frontend/src/App.test.tsx
git commit -m "feat: 串行调度前端生成批次"
```

---

### Task 5：历史页临时卡片合并与状态 UI

**文件：**
- 修改：`frontend/src/components/GenerationHistoryPage.tsx`
- 修改：`frontend/src/components/GenerationHistoryPage.test.tsx`
- 修改：`frontend/src/index.css`

**接口：**
- 消费：Task 4 传入的 `initialPromptCardId: number | null` 与 `sessionCards: SessionGenerationCard[]`。
- 保持：既有历史详情、预览、下载、删除与 persisted history 过滤行为。

- [ ] **Step 1：编写临时卡片合并纯函数的失败测试**

在历史页测试中增加 loading、failed、completed session card。调用待新增的 `buildHistoryDisplayItems` 和 `filterHistoryDisplayItems`，断言：

- completed session card 与 API 中同 ID 历史只出现一次。
- loading 与 failed 可按提示词卡片、模型和比例过滤。
- newest 排序按 `createdAtMs` 从大到小，同毫秒按 `sequence` 从大到小。

测试数据使用明确的 `clientId`、`createdAtMs` 和 `sequence`，不依赖当前时间。

- [ ] **Step 2：运行纯函数测试并确认红灯**

运行：

```powershell
Set-Location frontend
npm test -- src/components/GenerationHistoryPage.test.tsx
```

预期：`buildHistoryDisplayItems` 与 `filterHistoryDisplayItems` 未导出。

- [ ] **Step 3：实现统一展示模型**

在历史页定义：

```typescript
export type HistoryDisplayItem = {
  key: string;
  status: "loading" | "failed" | "completed";
  promptCardId: number;
  title: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  createdAtMs: number;
  sequence: number;
  history?: GenerationHistoryItem;
};
```

实现合并函数：

```typescript
export function buildHistoryDisplayItems(
  persisted: GenerationHistoryItem[],
  sessionCards: SessionGenerationCard[],
): HistoryDisplayItem[] {
  const sessionHistoryIds = new Set(
    sessionCards.flatMap((card) => card.history ? [card.history.id] : []),
  );
  const sessionEntries = sessionCards.map((card): HistoryDisplayItem => ({
    key: `session-${card.clientId}`,
    status: card.status,
    promptCardId: card.promptCardId,
    title: card.title,
    model: card.model,
    aspectRatio: card.aspectRatio,
    resolution: card.resolution,
    createdAtMs: card.createdAtMs,
    sequence: card.sequence,
    history: card.history,
  }));
  const persistedEntries = persisted
    .filter((item) => !sessionHistoryIds.has(item.id))
    .map((item): HistoryDisplayItem => ({
      key: `history-${item.id}`,
      status: "completed",
      promptCardId: item.prompt_card_id,
      title: displayHistoryTitle(item),
      model: item.model,
      aspectRatio: item.aspect_ratio,
      resolution: item.resolution,
      createdAtMs: item.created_at * 1000,
      sequence: item.id,
      history: item,
    }));
  return [...sessionEntries, ...persistedEntries];
}
```

实现过滤和排序函数：

```typescript
export function filterHistoryDisplayItems(
  items: HistoryDisplayItem[],
  filters: HistoryFilters,
): HistoryDisplayItem[] {
  const query = filters.query.trim().toLowerCase();
  const todayStart = startOfLocalDay(Date.now());
  const days = filters.timeRange === "week" ? 6 : 29;
  const minCreatedAtMs = filters.timeRange === "today"
    ? todayStart
    : filters.timeRange === "all"
      ? 0
      : todayStart - days * 24 * 60 * 60 * 1000;
  return items
    .filter((item) => {
      const haystack = `${item.title} ${item.model} ${item.aspectRatio}`.toLowerCase();
      return (!query || haystack.includes(query))
        && (filters.timeRange === "all" || item.createdAtMs >= minCreatedAtMs)
        && (!filters.model || item.model === filters.model)
        && (!filters.aspectRatio || item.aspectRatio === filters.aspectRatio)
        && (filters.promptCardId == null || item.promptCardId === filters.promptCardId);
    })
    .sort((left, right) => {
      const direction = filters.sort === "oldest" ? 1 : -1;
      return direction * (
        left.createdAtMs - right.createdAtMs || left.sequence - right.sequence
      );
    });
}
```

把既有 `filterHistoryItems` 改成兼容 wrapper，确保原有纯函数测试继续通过：

```typescript
export function filterHistoryItems(
  items: GenerationHistoryItem[],
  filters: HistoryFilters,
): GenerationHistoryItem[] {
  return filterHistoryDisplayItems(
    buildHistoryDisplayItems(items, []),
    filters,
  ).flatMap((item) => item.history ? [item.history] : []);
}
```

- [ ] **Step 4：编写历史页即时 loading 与失败 UI 的失败测试**

渲染 `GenerationHistoryPage` 时传入：

```tsx
<GenerationHistoryPage
  token="token"
  initialPromptCardId={10}
  sessionCards={[loadingCard, failedCard]}
/>
```

让历史 GET 保持 pending，仍应立即看到“生成中”和“生成失败”；筛选框值必须为 `10`。断言临时卡片没有“全屏预览”、下载和删除按钮。

- [ ] **Step 5：运行组件测试并确认红灯**

运行：

```powershell
Set-Location frontend
npm test -- src/components/GenerationHistoryPage.test.tsx
```

预期：组件 props 不接受临时卡片，且全页 loading 提前返回隐藏了临时内容。

- [ ] **Step 6：实现历史页 props、合并和 JSX 分支**

组件签名改为：

```typescript
type GenerationHistoryPageProps = {
  token: string;
  initialPromptCardId: number | null;
  sessionCards: SessionGenerationCard[];
};
```

filters 使用惰性初始化：

```typescript
const [filters, setFilters] = useState<HistoryFilters>(() => ({
  ...defaultHistoryFilters,
  promptCardId: initialPromptCardId,
}));
```

只有 `loading && sessionCards.length === 0` 时才显示全页“正在加载生成历史”；只有 `error && sessionCards.length === 0` 时才显示全页错误。存在临时卡片时仍渲染工具栏和合并列表，并把历史加载错误显示为非阻塞 alert。

模型和比例下拉选项必须从合并后的 `HistoryDisplayItem[]` 计算，空状态判断也必须使用合并列表，确保只有临时卡片时界面仍完整。临时卡片 JSX 固定为不可点击的 `<article>`：

```tsx
<article className={`history-card history-card--${entry.status}`}>
  <div className="history-card-image-frame history-card-state-frame">
    {entry.status === "loading" ? (
      <><span className="history-loading-spinner" aria-hidden="true" /><span>生成中</span></>
    ) : (
      <><span className="history-failed-icon" aria-hidden="true">!</span><span>生成失败</span></>
    )}
  </div>
  <div className="history-card-meta history-card-meta--static">
    <span className="history-card-title">{entry.title}</span>
    <span className="history-card-date">
      {entry.status === "failed" ? "请查看后台日志" : formatHistoryDateTime(entry.createdAtMs / 1000)}
    </span>
  </div>
</article>
```

completed entry 继续走现有可选中卡片分支。详情导航使用 visible completed histories，不能把临时卡片计入上一张/下一张计数。

- [ ] **Step 7：增加状态样式**

在历史卡片 CSS 后加入：

```css
.history-card-state-frame {
  display: flex;
  min-height: 154px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  color: #64748b;
  background: #f8fafc;
}

.history-loading-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #dbe4ee;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: history-spin 0.8s linear infinite;
}

.history-failed-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #dc2626;
  font-weight: 700;
}

.history-card-meta--static {
  cursor: default;
}

@keyframes history-spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 8：运行历史页和 App 集成测试**

运行：

```powershell
Set-Location frontend
npm test -- src/components/GenerationHistoryPage.test.tsx src/App.test.tsx
```

预期：临时状态、串行批次及既有历史功能全部通过。

- [ ] **Step 9：提交 Task 5**

```powershell
git add frontend/src/components/GenerationHistoryPage.tsx frontend/src/components/GenerationHistoryPage.test.tsx frontend/src/index.css
git commit -m "feat: 在历史页显示生成临时状态"
```

---

### Task 6：配置说明、全量回归与验收

**文件：**
- 修改：`.env.example`
- 修改：`README.md`

**接口：**
- 记录运行时所需 `GEMINI_API_KEY`、`GEMINI_BASE_URL`、`GEMINI_MODEL`。
- 不改变业务接口。

- [ ] **Step 1：更新环境变量示例**

在 `.env.example` 保留认证变量并追加：

```env
GEMINI_API_KEY=
GEMINI_BASE_URL=https://gemini.xyz365.tech/v1beta
GEMINI_MODEL=gemini-3.1-flash-image
```

- [ ] **Step 2：更新中文 README**

在本地启动章节说明：

- `GEMINI_API_KEY` 是执行图片生成时必需的密钥。
- Base URL 和模型已有默认值，只有代理地址或模型变化时才覆盖。
- “开始生成”会立即跳转历史页，前端一次只显示并生成一张。
- loading 与失败卡片刷新后消失，成功记录保留。
- 失败详情位于后端控制台和 `data/logs/app.log`。

- [ ] **Step 3：运行后端全量测试**

运行：

```powershell
Set-Location backend
python -m pytest -q
```

预期：退出码 0，所有后端测试通过。

- [ ] **Step 4：运行前端全量测试**

运行：

```powershell
Set-Location frontend
npm test
```

预期：退出码 0，所有 Vitest 测试通过，没有未处理 Promise rejection。

- [ ] **Step 5：运行前端生产构建**

运行：

```powershell
Set-Location frontend
npm run build
```

预期：`tsc -b` 和 Vite 均退出码 0，生成 `frontend/dist/`。

- [ ] **Step 6：检查最终变更质量**

运行：

```powershell
Set-Location C:\src\image-prompt-workbench
git diff --check
git status --short
```

预期：`git diff --check` 无输出；状态只包含本功能计划内文件以及用户原有的未提交文件，不包含 `.env`、生成图片、日志或数据库。

- [ ] **Step 7：提交文档与最终调整**

```powershell
git add .env.example README.md
git commit -m "docs: 说明 Gemini 图片生成配置"
```

- [ ] **Step 8：人工验收清单**

在已配置真实 `GEMINI_API_KEY` 的本地环境中，由用户决定是否执行一次付费冒烟测试。若执行，选择生成数量 2，确认：

1. 第一个 loading 出现后才发第一张。
2. 第一张成功或失败后，第二个 loading 才出现。
3. 历史筛选默认是当前提示词卡片。
4. 成功图片刷新后仍存在。
5. 失败时控制台与 `data/logs/app.log` 有对应记录。
6. 生成中返回工作台再次提交后，旧批次不再生成下一张。
