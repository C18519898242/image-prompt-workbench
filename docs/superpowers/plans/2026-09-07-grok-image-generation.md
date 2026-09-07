# Grok 图片生成支持实施计划

> **供代理执行者：** 必须使用 `executing-plans` 技能逐项实施本计划。步骤使用复选框跟踪；受项目规则约束，不使用子代理。

**目标：** 在现有图片生成工作台中增加可配置的“Grok Imagine”模型，支持文生图、参考图、比例提示和统一生成历史。

**架构：** 保留 `POST /api/generations` 作为统一业务入口，后端根据模型显示名分派到 Gemini 或新的 Grok Responses API 生成器。两个生成器共享图片输入输出类型，生成后的文件写入和历史记录继续复用现有流程；前端只负责模型选择及不适用参数的状态提示。

**技术栈：** Python 3、FastAPI、Pydantic Settings、urllib、Pillow、pytest、React、TypeScript、Vitest、Testing Library。

## 全局约束

- 所有文档和用户可见提示使用中文。
- 不使用子代理。
- 不把真实 Grok 密钥写入源码、提交、测试、日志或错误响应。
- 根目录 `.env` 可以保存真实密钥，但该文件必须继续被 Git 排除。
- 默认 Gemini 行为保持不变。
- Grok 仅增加图片能力，不增加视频、管理后台或动态模型发现。
- 所有生产代码遵循测试先行：先观察目标测试因缺少行为而失败，再写最小实现。

---

## 文件结构

- 新建 `backend/app/image_generation_types.py`：共享领域异常、参考图和生成图类型。
- 修改 `backend/app/gemini_image_generator.py`：改用共享类型，保留现有 Gemini 行为。
- 新建 `backend/app/grok_image_generator.py`：Grok 请求、响应解析、图片校验与重试。
- 修改 `backend/app/config.py`：增加 Grok 环境配置。
- 修改 `backend/app/main.py`：向应用状态注册两个生成器。
- 修改 `backend/app/routes/generations.py`：验证模型并分派生成器。
- 新建 `backend/tests/test_grok_image_generator.py`：覆盖 Grok 协议与错误边界。
- 修改 `backend/tests/test_config.py`：覆盖 Grok 默认配置。
- 修改 `backend/tests/test_gemini_image_generator.py`：共享类型迁移后的回归覆盖。
- 修改 `backend/tests/test_generation_routes.py`：覆盖模型分派、配置缺失和未知模型。
- 修改 `frontend/src/generation.ts`：扩展模型联合类型。
- 修改 `frontend/src/components/GenerationWorkspacePage.tsx`：新增模型选项和参数禁用逻辑。
- 修改 `frontend/src/components/GenerationWorkspacePage.test.tsx`：覆盖 Grok 选择、切换与提交。
- 修改 `frontend/src/index.css`：增加参数说明样式。
- 修改 `README.md`：记录 Grok 配置、能力和限制。
- 修改根目录 `.env`：写入真实 Grok 配置；该文件不提交。

---

### 任务 1：共享图片类型与 Grok 配置

**文件：**

- 新建：`backend/app/image_generation_types.py`
- 修改：`backend/app/gemini_image_generator.py`
- 修改：`backend/app/config.py`
- 修改：`backend/tests/test_config.py`
- 修改：`backend/tests/test_gemini_image_generator.py`

**接口：**

- 产出：`ImageGenerationError`、`ReferenceImage`、`GeneratedImage`。
- 产出：`Settings.grok_api_key: str`、`Settings.grok_base_url: str`、`Settings.grok_model: str`。
- 兼容：`GeminiImageError` 继承 `ImageGenerationError`，现有调用方仍可捕获 Gemini 专属异常。

- [ ] **步骤 1：先写配置和共享类型导入测试**

在 `backend/tests/test_config.py` 增加：

```python
def test_settings_has_grok_defaults() -> None:
    settings = Settings(
        auth_password_hash="hash",
        _env_file=None,
    )

    assert settings.grok_api_key == ""
    assert settings.grok_base_url == "https://grok-api.xyz365.tech/v1"
    assert settings.grok_model == "grok-4.5"
```

把 `backend/tests/test_gemini_image_generator.py` 中共享类型的导入改为：

```python
from app.gemini_image_generator import (
    GeminiHttpError,
    GeminiImageError,
    build_generation_request,
    extract_image,
    generate_image,
)
from app.image_generation_types import GeneratedImage, ReferenceImage
```

- [ ] **步骤 2：运行测试并确认按预期失败**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_config.py tests/test_gemini_image_generator.py -q
```

预期：测试收集阶段因 `app.image_generation_types` 不存在而失败，或配置断言因 `Settings` 没有 `grok_*` 字段而失败。

- [ ] **步骤 3：创建共享类型并迁移 Gemini 导入**

新建 `backend/app/image_generation_types.py`：

```python
from dataclasses import dataclass


class ImageGenerationError(RuntimeError):
    """图片生成请求或响应无效。"""


@dataclass(frozen=True)
class ReferenceImage:
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class GeneratedImage:
    data: bytes
    mime_type: str
```

在 `backend/app/gemini_image_generator.py` 删除 `dataclass` 导入和两个数据类定义，增加：

```python
from app.image_generation_types import (
    GeneratedImage,
    ImageGenerationError,
    ReferenceImage,
)


class GeminiImageError(ImageGenerationError):
    """Gemini 图片请求或响应无效。"""
```

在 `backend/app/config.py` 的 `Settings` 中增加：

```python
    grok_api_key: str = ""
    grok_base_url: str = "https://grok-api.xyz365.tech/v1"
    grok_model: str = "grok-4.5"
```

- [ ] **步骤 4：运行目标测试并确认通过**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_config.py tests/test_gemini_image_generator.py -q
```

预期：全部通过，Gemini 请求与响应行为没有变化。

- [ ] **步骤 5：提交共享类型和配置**

```powershell
git add backend/app/image_generation_types.py backend/app/gemini_image_generator.py backend/app/config.py backend/tests/test_config.py backend/tests/test_gemini_image_generator.py
git commit -m "refactor: 共享图片生成类型并增加 Grok 配置"
```

---

### 任务 2：实现 Grok Responses API 图片生成器

**文件：**

- 新建：`backend/app/grok_image_generator.py`
- 新建：`backend/tests/test_grok_image_generator.py`

**接口：**

- 消费：`ReferenceImage` 和 `GeneratedImage`。
- 产出：`build_generation_request(*, model, prompt, references, aspect_ratio) -> dict[str, Any]`。
- 产出：`extract_image(response) -> GeneratedImage`。
- 产出：`generate_image(*, api_key, base_url, model, prompt, references, aspect_ratio, transport, sleeper, timeout, max_attempts) -> GeneratedImage`。
- 产出：`GrokImageError` 和带 `status` 字段的 `GrokHttpError`。

- [ ] **步骤 1：写请求构造的失败测试**

新建 `backend/tests/test_grok_image_generator.py`，先加入：

```python
import base64
import io

from PIL import Image
import pytest

from app.grok_image_generator import (
    GrokHttpError,
    GrokImageError,
    build_generation_request,
    extract_image,
    generate_image,
)
from app.image_generation_types import ReferenceImage


def image_bytes(image_format: str = "JPEG") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (12, 20), "#123456").save(output, format=image_format)
    return output.getvalue()


def test_build_request_uses_string_input_without_references() -> None:
    request = build_generation_request(
        model="grok-4.5",
        prompt="生成一只猫",
        references=[],
        aspect_ratio="9:16",
    )

    assert request == {
        "model": "grok-4.5",
        "input": "最终图片必须为 9:16 画幅。\n\n生成一只猫",
        "tools": [{"type": "image_generation", "action": "auto"}],
        "tool_choice": {"type": "image_generation"},
    }


def test_build_request_uses_multimodal_input_for_references() -> None:
    request = build_generation_request(
        model="grok-4.5",
        prompt="保持人物特征",
        references=[
            ReferenceImage("image/png", b"first"),
            ReferenceImage("image/webp", b"second"),
        ],
        aspect_ratio="Auto",
    )

    assert request["input"] == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "保持人物特征"},
                {
                    "type": "input_image",
                    "image_url": "data:image/png;base64,Zmlyc3Q=",
                },
                {
                    "type": "input_image",
                    "image_url": "data:image/webp;base64,c2Vjb25k",
                },
            ],
        }
    ]
```

- [ ] **步骤 2：运行请求构造测试并确认失败**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_grok_image_generator.py -q
```

预期：因 `app.grok_image_generator` 不存在而失败。

- [ ] **步骤 3：实现请求构造和领域异常**

新建 `backend/app/grok_image_generator.py` 的第一部分：

```python
from __future__ import annotations

import base64
import binascii
import io
import json
import logging
import time
from typing import Any, Callable, TypeAlias
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image, UnidentifiedImageError

from app.image_generation_types import (
    GeneratedImage,
    ImageGenerationError,
    ReferenceImage,
)

logger = logging.getLogger("app.generation")


class GrokImageError(ImageGenerationError):
    """Grok 图片请求或响应无效。"""


class GrokHttpError(GrokImageError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


Transport: TypeAlias = Callable[
    [str, dict[str, str], dict[str, Any], float],
    dict[str, Any],
]


def _prompt_with_ratio(prompt: str, aspect_ratio: str) -> str:
    if aspect_ratio == "Auto":
        return prompt
    return f"最终图片必须为 {aspect_ratio} 画幅。\n\n{prompt}"


def build_generation_request(
    *,
    model: str,
    prompt: str,
    references: list[ReferenceImage],
    aspect_ratio: str,
) -> dict[str, Any]:
    final_prompt = _prompt_with_ratio(prompt, aspect_ratio)
    input_value: str | list[dict[str, Any]] = final_prompt
    if references:
        content: list[dict[str, str]] = [
            {"type": "input_text", "text": final_prompt}
        ]
        content.extend(
            {
                "type": "input_image",
                "image_url": (
                    f"data:{reference.mime_type};base64,"
                    f"{base64.b64encode(reference.data).decode('ascii')}"
                ),
            }
            for reference in references
        )
        input_value = [{"role": "user", "content": content}]
    return {
        "model": model,
        "input": input_value,
        "tools": [{"type": "image_generation", "action": "auto"}],
        "tool_choice": {"type": "image_generation"},
    }
```

- [ ] **步骤 4：运行请求构造测试并确认通过**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_grok_image_generator.py -q
```

预期：两个请求构造测试通过。

- [ ] **步骤 5：写图片解析和重试的失败测试**

向 `backend/tests/test_grok_image_generator.py` 增加：

```python
def test_extract_image_reads_completed_image_call() -> None:
    encoded = base64.b64encode(image_bytes()).decode("ascii")

    generated = extract_image(
        {
            "output": [
                {"type": "reasoning"},
                {
                    "type": "image_generation_call",
                    "status": "completed",
                    "result": encoded,
                },
            ]
        }
    )

    assert generated.data == image_bytes()
    assert generated.mime_type == "image/jpeg"


@pytest.mark.parametrize(
    "response",
    [
        {},
        {"output": []},
        {"output": [{"type": "message"}]},
        {"output": [{"type": "image_generation_call", "result": "%%%"}]},
    ],
)
def test_extract_image_rejects_invalid_results(response) -> None:
    with pytest.raises(GrokImageError):
        extract_image(response)


def test_generate_image_posts_to_responses_and_retries_5xx() -> None:
    attempts = []
    sleeps = []
    encoded = base64.b64encode(image_bytes("PNG")).decode("ascii")

    def transport(url, headers, payload, timeout):
        attempts.append((url, headers, payload, timeout))
        if len(attempts) == 1:
            raise GrokHttpError(502, "暂时不可用")
        return {
            "output": [
                {"type": "image_generation_call", "result": encoded}
            ]
        }

    generated = generate_image(
        api_key="secret",
        base_url="https://gateway.example/v1/",
        model="grok-4.5",
        prompt="生成图片",
        references=[],
        aspect_ratio="1:1",
        transport=transport,
        sleeper=sleeps.append,
    )

    assert generated.mime_type == "image/png"
    assert len(attempts) == 2
    assert attempts[0][0] == "https://gateway.example/v1/responses"
    assert attempts[0][1] == {"Authorization": "Bearer secret"}
    assert attempts[0][3] == 120.0
    assert sleeps == [1.0]


def test_generate_image_does_not_retry_non_retryable_4xx() -> None:
    attempts = 0

    def transport(url, headers, payload, timeout):
        nonlocal attempts
        attempts += 1
        raise GrokHttpError(403, "禁止访问")

    with pytest.raises(GrokHttpError):
        generate_image(
            api_key="secret",
            base_url="https://gateway.example/v1",
            model="grok-4.5",
            prompt="生成图片",
            references=[],
            aspect_ratio="Auto",
            transport=transport,
            sleeper=lambda delay: None,
        )

    assert attempts == 1
```

- [ ] **步骤 6：运行新增测试并确认失败原因正确**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_grok_image_generator.py -q
```

预期：因 `extract_image` 和 `generate_image` 尚未定义或未实现而失败。

- [ ] **步骤 7：实现图片解析、HTTP 传输和重试**

在 `backend/app/grok_image_generator.py` 追加：

```python
def extract_image(response: dict[str, Any]) -> GeneratedImage:
    output = response.get("output")
    if not isinstance(output, list):
        raise GrokImageError("Grok 没有返回图片")
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "image_generation_call":
            continue
        encoded = item.get("result")
        if not isinstance(encoded, str) or not encoded:
            continue
        try:
            raw = base64.b64decode(encoded, validate=True)
            with Image.open(io.BytesIO(raw)) as image:
                image_format = image.format
                image.verify()
        except (binascii.Error, ValueError, OSError, UnidentifiedImageError) as error:
            raise GrokImageError("Grok 返回的图片无效") from error
        mime_type = {"JPEG": "image/jpeg", "PNG": "image/png"}.get(image_format)
        if mime_type is None:
            raise GrokImageError("Grok 返回了不支持的图片格式")
        return GeneratedImage(raw, mime_type)
    raise GrokImageError("Grok 没有返回图片")


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
        raise GrokHttpError(
            int(error.code),
            _safe_error_message(error_body),
        ) from error
    except URLError as error:
        raise GrokImageError(f"Grok 网络请求失败：{error.reason}") from error
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GrokImageError("Grok 响应不是有效 JSON") from error
    if not isinstance(decoded, dict):
        raise GrokImageError("Grok JSON 响应顶层不是对象")
    return decoded


def generate_image(
    *,
    api_key: str,
    base_url: str,
    model: str,
    prompt: str,
    references: list[ReferenceImage],
    aspect_ratio: str,
    transport: Transport = http_post_json,
    sleeper: Callable[[float], None] = time.sleep,
    timeout: float = 120.0,
    max_attempts: int = 3,
) -> GeneratedImage:
    url = f"{base_url.rstrip('/')}/responses"
    headers = {"Authorization": f"Bearer {api_key}"}
    payload = build_generation_request(
        model=model,
        prompt=prompt,
        references=references,
        aspect_ratio=aspect_ratio,
    )
    for attempt in range(1, max_attempts + 1):
        try:
            return extract_image(transport(url, headers, payload, timeout))
        except GrokHttpError as error:
            retryable = error.status == 429 or error.status >= 500
            if not retryable or attempt == max_attempts:
                raise
        except GrokImageError:
            if attempt == max_attempts:
                raise
        logger.warning(
            "Grok 图片请求准备重试 attempt=%s max_attempts=%s model=%s",
            attempt,
            max_attempts,
            model,
        )
        sleeper(float(attempt))
    raise GrokImageError("Grok 图片生成失败")
```

- [ ] **步骤 8：运行 Grok 生成器测试并确认通过**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_grok_image_generator.py -q
```

预期：全部通过。

- [ ] **步骤 9：提交 Grok 生成器**

```powershell
git add backend/app/grok_image_generator.py backend/tests/test_grok_image_generator.py
git commit -m "feat: 增加 Grok 图片生成客户端"
```

---

### 任务 3：在统一生成路由中分派 Gemini 与 Grok

**文件：**

- 修改：`backend/app/main.py`
- 修改：`backend/app/routes/generations.py`
- 修改：`backend/tests/test_generation_routes.py`

**接口：**

- 消费：任务 2 的 `grok_image_generator.generate_image`。
- 产出：`application.state.gemini_image_generator` 和 `application.state.grok_image_generator`。
- 行为：`model="Nano Banana 2"` 走 Gemini，`model="Grok Imagine"` 走 Grok，其他值返回 422。

- [ ] **步骤 1：把现有路由夹具改成双生成器并写失败测试**

在 `backend/tests/test_generation_routes.py`：

1. 把 `GeneratedImage` 和 `ImageGenerationError` 改从共享模块导入。
2. 为测试 `Settings` 增加 `grok_api_key="grok-secret"`。
3. 把现有 `app.state.image_generator` 替换为 `app.state.gemini_image_generator`。
4. 增加以下测试：

```python
def test_create_grok_generation_uses_grok_generator(
    generation_client, password, png_bytes
) -> None:
    captured = {}

    def fake_grok_generator(**kwargs):
        captured.update(kwargs)
        return GeneratedImage(png_bytes, "image/png")

    generation_client.app.state.grok_image_generator = fake_grok_generator
    token = login(generation_client, password)
    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "prompt_card_id": "1",
            "prompt": "生成竖版人物",
            "model": "Grok Imagine",
            "aspect_ratio": "9:16",
            "resolution": "1K",
            "thinking_level": "minimal",
        },
        files=[
            ("reference_images", ("ref.png", png_bytes, "image/png")),
        ],
    )

    assert response.status_code == 201
    assert response.json()["model"] == "Grok Imagine"
    assert captured["api_key"] == "grok-secret"
    assert captured["base_url"] == "https://grok-api.xyz365.tech/v1"
    assert captured["model"] == "grok-4.5"
    assert captured["prompt"] == "生成竖版人物"
    assert captured["aspect_ratio"] == "9:16"
    assert captured["references"][0].mime_type == "image/png"


def test_grok_generation_requires_grok_api_key(
    generation_client, password
) -> None:
    generation_client.app.state.settings.grok_api_key = ""
    token = login(generation_client, password)
    form = generation_form()
    form["model"] = "Grok Imagine"

    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data=form,
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "尚未配置 GROK_API_KEY"


def test_generation_rejects_unknown_model(generation_client, password) -> None:
    token = login(generation_client, password)
    form = generation_form()
    form["model"] = "Unknown"

    response = generation_client.post(
        "/api/generations",
        headers={"Authorization": f"Bearer {token}"},
        data=form,
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "暂不支持该模型"
```

把失败生成器测试改为抛出共享异常：

```python
    def failing_generator(**kwargs):
        raise ImageGenerationError("上游没有返回图片")
```

- [ ] **步骤 2：运行路由测试并确认失败**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_generation_routes.py -q
```

预期：Grok 测试因路由仍固定检查 Gemini 密钥并调用单一生成器而失败，未知模型测试因当前接口接受任意字符串而失败。

- [ ] **步骤 3：注册双生成器**

在 `backend/app/main.py` 调整导入：

```python
from app.gemini_image_generator import generate_image as generate_gemini_image
from app.grok_image_generator import generate_image as generate_grok_image
```

在 `create_app` 中替换单一状态：

```python
    application.state.gemini_image_generator = generate_gemini_image
    application.state.grok_image_generator = generate_grok_image
```

- [ ] **步骤 4：实现模型分派**

在 `backend/app/routes/generations.py`：

1. 从共享模块导入 `GeneratedImage`、`ImageGenerationError` 和 `ReferenceImage`。
2. 删除对 `GeminiImageError` 的依赖。
3. 增加显示名常量：

```python
GEMINI_DISPLAY_MODEL = "Nano Banana 2"
GROK_DISPLAY_MODEL = "Grok Imagine"
SUPPORTED_MODELS = {GEMINI_DISPLAY_MODEL, GROK_DISPLAY_MODEL}
```

在配置检查前增加：

```python
    if model not in SUPPORTED_MODELS:
        raise HTTPException(status_code=422, detail="暂不支持该模型")
    if model == GEMINI_DISPLAY_MODEL and not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="尚未配置 GEMINI_API_KEY")
    if model == GROK_DISPLAY_MODEL and not settings.grok_api_key:
        raise HTTPException(status_code=503, detail="尚未配置 GROK_API_KEY")
```

用下列分派替换现有固定生成器调用：

```python
        generated: GeneratedImage
        actual_model: str
        if model == GEMINI_DISPLAY_MODEL:
            actual_model = settings.gemini_model
            generated = request.app.state.gemini_image_generator(
                api_key=settings.gemini_api_key,
                base_url=settings.gemini_base_url,
                model=actual_model,
                prompt=normalized_prompt,
                references=references,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                thinking_level=thinking_level,
            )
        else:
            actual_model = settings.grok_model
            generated = request.app.state.grok_image_generator(
                api_key=settings.grok_api_key,
                base_url=settings.grok_base_url,
                model=actual_model,
                prompt=normalized_prompt,
                references=references,
                aspect_ratio=aspect_ratio,
            )
```

把异常捕获改为：

```python
    except (ImageGenerationError, OSError, sqlite3.Error, RuntimeError) as error:
```

把日志的模型参数从 `settings.gemini_model` 改为在进入生成块前计算的：

```python
    actual_model = (
        settings.gemini_model
        if model == GEMINI_DISPLAY_MODEL
        else settings.grok_model
    )
```

同时把 `write_generated_image` 的不支持格式消息改为通用文案：

```python
        raise ImageGenerationError("图片生成服务返回了不支持的图片格式")
```

- [ ] **步骤 5：运行路由测试并确认通过**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_generation_routes.py -q
```

预期：全部通过；两种模型分别调用自己的测试替身，未知模型被拒绝。

- [ ] **步骤 6：运行后端相关回归测试**

运行：

```powershell
Set-Location backend
python -m pytest tests/test_config.py tests/test_gemini_image_generator.py tests/test_grok_image_generator.py tests/test_generation_routes.py -q
```

预期：全部通过。

- [ ] **步骤 7：提交后端模型分派**

```powershell
git add backend/app/main.py backend/app/routes/generations.py backend/tests/test_generation_routes.py
git commit -m "feat: 在生成接口中分派 Grok 模型"
```

---

### 任务 4：增加前端 Grok 模型和参数状态

**文件：**

- 修改：`frontend/src/generation.ts`
- 修改：`frontend/src/components/GenerationWorkspacePage.tsx`
- 修改：`frontend/src/components/GenerationWorkspacePage.test.tsx`
- 修改：`frontend/src/index.css`

**接口：**

- 产出：`GenerationModel = "Nano Banana 2" | "Grok Imagine"`。
- 行为：选择 Grok 时提交兼容值 `resolution="1K"`、`thinkingLevel="minimal"`，但比例、数量和参考图保持可用。

- [ ] **步骤 1：写 Grok 模型交互的失败测试**

在 `frontend/src/components/GenerationWorkspacePage.test.tsx` 中把基础参数的模型断言改为：

```typescript
  expect(optionValues("模型")).toEqual(["Nano Banana 2", "Grok Imagine"]);
```

增加测试：

```typescript
test("选择 Grok 后归一化并禁用不适用参数", async () => {
  const user = userEvent.setup();
  const { onGenerate } = renderWorkspace();

  await user.selectOptions(screen.getByLabelText("分辨率"), "2K");
  await user.selectOptions(screen.getByLabelText("思考级别"), "high");
  await user.selectOptions(screen.getByLabelText("模型"), "Grok Imagine");

  expect(screen.getByLabelText("分辨率")).toBeDisabled();
  expect(screen.getByLabelText("分辨率")).toHaveValue("1K");
  expect(screen.getByLabelText("思考级别")).toBeDisabled();
  expect(screen.getByLabelText("思考级别")).toHaveValue("minimal");
  expect(screen.getAllByText("由 Grok 自动决定")).toHaveLength(2);
  expect(screen.getByLabelText("比例")).toBeEnabled();
  expect(screen.getByLabelText("生成数量")).toBeEnabled();
  expect(screen.getByLabelText("上传生成参考图")).toBeEnabled();

  await user.selectOptions(screen.getByLabelText("比例"), "9:16");
  await user.click(screen.getByRole("button", { name: "开始生成" }));

  expect(onGenerate).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "Grok Imagine",
      aspectRatio: "9:16",
      resolution: "1K",
      thinkingLevel: "minimal",
    }),
  );
});


test("从 Grok 切回 Gemini 后恢复参数控件", async () => {
  const user = userEvent.setup();
  renderWorkspace();

  await user.selectOptions(screen.getByLabelText("模型"), "Grok Imagine");
  await user.selectOptions(screen.getByLabelText("模型"), "Nano Banana 2");

  expect(screen.getByLabelText("分辨率")).toBeEnabled();
  expect(screen.getByLabelText("思考级别")).toBeEnabled();
  expect(screen.queryByText("由 Grok 自动决定")).not.toBeInTheDocument();
});
```

- [ ] **步骤 2：运行组件测试并确认失败**

运行：

```powershell
Set-Location frontend
npm test -- --run src/components/GenerationWorkspacePage.test.tsx
```

预期：模型选项断言失败，且无法选择 `Grok Imagine`。

- [ ] **步骤 3：扩展模型类型和组件状态**

在 `frontend/src/generation.ts` 增加并使用模型类型：

```typescript
export type GenerationModel = "Nano Banana 2" | "Grok Imagine";

export type GenerationSubmission = {
  card: PromptCard;
  prompt: string;
  model: GenerationModel;
  aspectRatio: AspectRatio;
  resolution: "1K" | "2K";
  quantity: 1 | 2 | 4;
  thinkingLevel: "minimal" | "high";
  referenceImages: File[];
};
```

在 `GenerationWorkspacePage.tsx` 导入 `GenerationModel`，并把 `GenerationParams.model` 改为该类型：

```typescript
import type {
  AspectRatio,
  GenerationModel,
  GenerationSubmission,
} from "../generation";

type GenerationParams = {
  model: GenerationModel;
  aspectRatio: AspectRatio;
  resolution: "1K" | "2K";
  quantity: "1" | "2" | "4";
  thinkingLevel: "minimal" | "high";
};
```

在组件状态之后计算：

```typescript
  const isGrok = generationParams.model === "Grok Imagine";
```

把模型选择器改为：

```tsx
<select
  value={generationParams.model}
  onChange={(event) => {
    const model = event.target.value as GenerationModel;
    setGenerationParams((params) => ({
      ...params,
      model,
      ...(model === "Grok Imagine"
        ? { resolution: "1K", thinkingLevel: "minimal" }
        : {}),
    }));
  }}
>
  <option value="Nano Banana 2">Nano Banana 2</option>
  <option value="Grok Imagine">Grok Imagine</option>
</select>
```

为分辨率和思考级别 `select` 增加 `disabled={isGrok}`，并在每个选择器后增加：

```tsx
{isGrok && (
  <span className="generation-parameter-hint">由 Grok 自动决定</span>
)}
```

- [ ] **步骤 4：增加参数说明样式**

在 `frontend/src/index.css` 的生成参数样式附近增加：

```css
.generation-parameter-hint {
  color: #7a8392;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
}

.generation-workspace select:disabled {
  cursor: not-allowed;
  color: #7a8392;
  background: #f4f5f7;
}
```

- [ ] **步骤 5：运行组件测试并确认通过**

运行：

```powershell
Set-Location frontend
npm test -- --run src/components/GenerationWorkspacePage.test.tsx
```

预期：全部通过。

- [ ] **步骤 6：运行前端相关回归测试**

运行：

```powershell
Set-Location frontend
npm test -- --run src/api.test.ts src/components/GenerationWorkspacePage.test.tsx
```

预期：统一表单协议和组件行为全部通过。

- [ ] **步骤 7：提交前端支持**

```powershell
git add frontend/src/generation.ts frontend/src/components/GenerationWorkspacePage.tsx frontend/src/components/GenerationWorkspacePage.test.tsx frontend/src/index.css
git commit -m "feat: 在生成工作台增加 Grok 模型"
```

---

### 任务 5：配置说明、真实密钥和完整验证

**文件：**

- 修改：`README.md`
- 修改但不提交：`.env`

**接口：**

- 消费：任务 1 的三个 `GROK_*` 配置项。
- 产出：可由 Docker Compose 和本地后端读取的真实 Grok 配置。
- 产出：中文部署与能力说明。

- [ ] **步骤 1：先写文档验收检查命令并确认当前失败**

运行：

```powershell
rg -n "GROK_API_KEY|GROK_BASE_URL|GROK_MODEL|Grok Imagine" README.md
```

预期：没有匹配，证明 Grok 配置文档尚未加入。

- [ ] **步骤 2：补充 README 配置和限制说明**

在 `README.md` 的 `.env` 示例中增加占位配置：

```dotenv
GROK_API_KEY=
GROK_BASE_URL=https://grok-api.xyz365.tech/v1
GROK_MODEL=grok-4.5
```

在图片生成说明中增加：

```markdown
### Grok Imagine

生成工作台选择“Grok Imagine”后，后端通过 Grok Responses API 的
`image_generation` 工具生成图片。支持文生图以及最多 8 张参考图。

- 比例会作为明确约束加入提示词；选择 `Auto` 时不增加比例约束。
- Grok 图片工具自动决定实际分辨率和思考过程，因此界面中的这两项会禁用。
- `GROK_MODEL` 默认使用 `grok-4.5`，可通过环境变量切换兼容模型。
- 目标网关可能有独立的上游超时限制，本项目内部重试无法绕过网关限制。
```

- [ ] **步骤 3：把真实 Grok 配置写入被忽略的 `.env`**

先验证忽略规则：

```powershell
git check-ignore -v .env
```

预期：输出 `.gitignore:1:.env`。

使用 `apply_patch` 在根目录 `.env` 追加或更新三个键。`GROK_API_KEY` 使用用户在当前任务中已提供的实际值，但不得把值复制到计划、终端输出、日志或提交；另外两个键使用以下确定值：

```dotenv
GROK_BASE_URL=https://grok-api.xyz365.tech/v1
GROK_MODEL=grok-4.5
```

更新后只输出键名进行检查：

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { $matches[1] }
} | Sort-Object -Unique
```

预期：包含 `GROK_API_KEY`、`GROK_BASE_URL` 和 `GROK_MODEL`，不显示任何值。

- [ ] **步骤 4：运行后端完整测试**

运行：

```powershell
Set-Location backend
python -m pytest -q
```

预期：全部通过，无错误和警告。

- [ ] **步骤 5：运行前端完整测试**

运行：

```powershell
Set-Location frontend
npm test -- --run
```

预期：全部通过，无失败用例。

- [ ] **步骤 6：运行前端生产构建**

运行：

```powershell
Set-Location frontend
npm run build
```

预期：TypeScript 检查和 Vite 构建成功，产物写入被忽略的 `frontend/dist/`。

- [ ] **步骤 7：执行静态安全检查**

运行：

```powershell
Set-Location C:\src\image-prompt-workbench
git diff --check
git status --short
git grep -n "g2a_"
```

预期：`git diff --check` 无输出；`.env` 不出现在状态中；`git grep -n "g2a_"` 无输出。

- [ ] **步骤 8：提交文档**

```powershell
git add README.md
git commit -m "docs: 说明 Grok 图片生成配置"
```

- [ ] **步骤 9：可选真实冒烟测试**

启动或重启后端，使其重新读取 `.env`。登录工作台后选择“Grok Imagine”，以 `9:16`、数量 `1`、无参考图生成一张简单测试图，再用一张 PNG 参考图生成第二张。

预期：两次请求均进入现有生成历史；历史模型显示“Grok Imagine”；生成文件可正常预览和下载；日志不包含密钥、Data URL 或图片 Base64。若目标网关返回自身的上游超时错误，记录为外部限制，但不据此判定自动化实现失败。

---

## 最终完成条件

- 五个任务的目标测试均经历过红灯和绿灯。
- 后端完整测试、前端完整测试和生产构建通过。
- `Nano Banana 2` 默认行为无回归。
- “Grok Imagine”支持文生图、参考图和比例提示。
- Grok 模式明确禁用无效参数。
- `.env` 含真实本机配置但不受 Git 跟踪。
- Git 已跟踪内容和日志中没有真实密钥或图片 Base64。
