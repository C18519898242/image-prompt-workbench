# 生成历史数据 API 实现计划

> **给执行代理：** 实现时必须使用 subagent-driven-development 或 executing-plans，按任务逐项执行并用复选框跟踪。不得使用 subagent le1。

**目标：** 为每张成功生成的图片提供最小的历史数据保存、列表、详情、按提示词卡片筛选和删除 API。

**架构：** 在现有 SQLite 中新增 generation_history 表，每条记录通过 prompt_card_id 关联一张 prompt_cards。使用独立 Repository 封装数据库操作，使用独立 FastAPI 路由提供四个鉴权接口；标题和图片 URL 都在响应时计算，不增加数据库字段。

**技术栈：** Python、FastAPI、Pydantic、SQLite、pytest、FastAPI TestClient。

## 全局约束

- 所有接口继续使用现有 Bearer Token 鉴权。
- 只实现后端 API，不修改历史页面或生成工作台页面。
- 每张生成图片一条历史记录，不增加批次表、任务状态或失败记录。
- 历史表只保存 prompt_card_id，不保存 prompt_text、title 或参考图。
- title 在响应中按 prompt_cards.title + 空格 + created_at 生成，created_at 是 Unix 秒级时间戳；同一秒的多张图片允许同名。
- 生成图片路径必须位于 data/generated-images/，API 不接收图片二进制。
- 列表只支持可选的 prompt_card_id 筛选，不增加搜索、分页、日期、模型、比例或自定义排序参数。
- 不安装新依赖；沿用现有 SQLite 连接、Repository 和 require_token 模式。
- 代码和测试遵循现有 Python 格式；文档使用中文。

---

### 任务 1：新增历史数据表、索引和迁移

**文件：**

- 修改：backend/schema.sql
- 新建：backend/migrations/2026-08-02-add-generation-history.sql
- 修改：backend/tests/test_database.py

**接口：**

- 产生 generation_history 表，供 Repository 和路由任务使用。
- 产生 idx_generation_history_prompt_card 索引，支持按 prompt_card_id 查询。

- [ ] **步骤 1：先补充失败的数据库测试**

在 backend/tests/test_database.py 中把现有表集合更新为包含 generation_history，并加入以下测试：

~~~python
def test_generation_history_contains_expected_columns(
    database: sqlite3.Connection,
) -> None:
    columns = {
        row[1]: (row[2], row[3])
        for row in database.execute("PRAGMA table_info(generation_history)")
    }

    assert columns == {
        "id": ("INTEGER", 0),
        "prompt_card_id": ("INTEGER", 1),
        "image_path": ("TEXT", 1),
        "model": ("TEXT", 1),
        "aspect_ratio": ("TEXT", 1),
        "resolution": ("TEXT", 1),
        "created_at": ("INTEGER", 1),
    }


def test_generation_history_has_prompt_card_lookup_index(
    database: sqlite3.Connection,
) -> None:
    indexes = {
        row[1]
        for row in database.execute("PRAGMA index_list(generation_history)")
    }

    assert "idx_generation_history_prompt_card" in indexes


def test_generation_history_keeps_prompt_card_as_required_source(
    database: sqlite3.Connection,
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        database.execute(
            "INSERT INTO generation_history "
            "(prompt_card_id, image_path, model, aspect_ratio, resolution) "
            "VALUES (?, ?, ?, ?, ?)",
            (999, "generated-images/missing.png", "model", "4:3", "1K"),
        )


def test_generation_history_migration_is_idempotent(tmp_path: Path) -> None:
    connection = sqlite3.connect(tmp_path / "app.db")
    connection.executescript(
        """
        CREATE TABLE prompt_cards (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            prompt_text TEXT NOT NULL,
            example_image_path TEXT NOT NULL
        );
        """
    )
    migration = Path(__file__).resolve().parents[1] / (
        "migrations/2026-08-02-add-generation-history.sql"
    )

    connection.executescript(migration.read_text(encoding="utf-8"))
    connection.executescript(migration.read_text(encoding="utf-8"))

    assert connection.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type = 'table' AND name = 'generation_history'"
    ).fetchone() == ("generation_history",)
    connection.close()
~~~

- [ ] **步骤 2：运行数据库测试，确认新增断言先失败**

运行：

~~~powershell
cd backend
python -m pytest tests/test_database.py -q
~~~

预期：失败，因为 schema.sql 尚未创建 generation_history。

- [ ] **步骤 3：在主 schema 中创建最小历史表**

在 backend/schema.sql 现有三张表之后加入：

~~~sql
CREATE TABLE IF NOT EXISTS generation_history (
    id INTEGER PRIMARY KEY,
    prompt_card_id INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    model TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    resolution TEXT NOT NULL,
    created_at INTEGER NOT NULL
        DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
    FOREIGN KEY (prompt_card_id)
        REFERENCES prompt_cards(id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_generation_history_prompt_card
ON generation_history(prompt_card_id);
~~~

- [ ] **步骤 4：为已有数据库增加同样的迁移**

将完全相同的 CREATE TABLE IF NOT EXISTS 和 CREATE INDEX IF NOT EXISTS 写入 backend/migrations/2026-08-02-add-generation-history.sql。迁移只新增表和索引，不修改已有表数据。

- [ ] **步骤 5：运行数据库测试确认通过**

运行：

~~~powershell
cd backend
python -m pytest tests/test_database.py -q
~~~

预期：全部测试通过。

- [ ] **步骤 6：提交数据库结构变更**

~~~powershell
git add backend/schema.sql backend/migrations/2026-08-02-add-generation-history.sql backend/tests/test_database.py
git commit -m "feat: 新增生成历史数据表"
~~~

---

### 任务 2：实现历史数据 Repository

**文件：**

- 新建：backend/app/generation_history_repository.py
- 新建：backend/tests/test_generation_history_repository.py

**接口：**

- 消费：任务 1 创建的 generation_history 表和 prompt_cards 表。
- 产生：GenerationHistoryRepository.create_history、get_history、list_histories、delete_history。

数据对象固定为：

~~~python
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
~~~

- [ ] **步骤 1：先写 Repository 行为测试**

在 backend/tests/test_generation_history_repository.py 中创建使用 schema.sql 的 SQLite fixture。fixture 分别暴露 connection 和 GenerationHistoryRepository，测试通过 connection 插入提示词卡片；同时覆盖新增、关联标题、列表筛选、详情和删除：

~~~python
@pytest.fixture
def connection(tmp_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(tmp_path / "app.db")
    schema = Path(__file__).resolve().parents[1] / "schema.sql"
    connection.executescript(schema.read_text(encoding="utf-8"))
    yield connection
    connection.close()


@pytest.fixture
def repository(connection: sqlite3.Connection) -> GenerationHistoryRepository:
    return GenerationHistoryRepository(connection)


def _create_card(connection: sqlite3.Connection, title: str) -> int:
    cursor = connection.execute(
        "INSERT INTO prompt_cards "
        "(title, prompt_text, example_image_path) VALUES (?, ?, ?)",
        (title, f"{title}提示词", "prompt-images/example.png"),
    )
    connection.commit()
    return int(cursor.lastrowid)
~~~

~~~python
def test_create_and_get_history_returns_prompt_card_title(
    repository: GenerationHistoryRepository,
    connection: sqlite3.Connection,
) -> None:
    card_id = _create_card(connection, "江南烟雨")

    history_id = repository.create_history(
        prompt_card_id=card_id,
        image_path="generated-images/1754447075.png",
        model="Nano Banana 2",
        aspect_ratio="4:3",
        resolution="1K",
        created_at=1754447075,
    )

    history = repository.get_history(history_id)

    assert history is not None
    assert history.prompt_card_id == card_id
    assert history.prompt_card_title == "江南烟雨"
    assert history.image_path == "generated-images/1754447075.png"
    assert history.created_at == 1754447075


def test_list_histories_orders_newest_first_and_filters_by_card(
    repository: GenerationHistoryRepository,
    connection: sqlite3.Connection,
) -> None:
    first_card_id = _create_card(connection, "第一张卡")
    second_card_id = _create_card(connection, "第二张卡")
    older_id = repository.create_history(
        prompt_card_id=first_card_id,
        image_path="generated-images/1.png",
        model="model",
        aspect_ratio="4:3",
        resolution="1K",
        created_at=100,
    )
    newest_id = repository.create_history(
        prompt_card_id=second_card_id,
        image_path="generated-images/2.png",
        model="model",
        aspect_ratio="1:1",
        resolution="2K",
        created_at=200,
    )

    assert [item.id for item in repository.list_histories()] == [
        newest_id,
        older_id,
    ]
    assert [
        item.prompt_card_id
        for item in repository.list_histories(prompt_card_id=second_card_id)
    ] == [second_card_id]


def test_delete_history_returns_true_once_and_false_afterward(
    repository: GenerationHistoryRepository,
    connection: sqlite3.Connection,
) -> None:
    card_id = _create_card(connection, "待删除卡")
    history_id = repository.create_history(
        prompt_card_id=card_id,
        image_path="generated-images/delete.png",
        model="model",
        aspect_ratio="4:3",
        resolution="1K",
    )

    assert repository.delete_history(history_id) is True
    assert repository.delete_history(history_id) is False
    assert repository.get_history(history_id) is None
~~~

测试 fixture 中的 _create_card() 每次只插入一张最小合法提示词卡片；测试不依赖前端或图片文件。

- [ ] **步骤 2：运行 Repository 测试确认先失败**

运行：

~~~powershell
cd backend
python -m pytest tests/test_generation_history_repository.py -q
~~~

预期：失败，因为 Repository 文件和方法尚未存在。

- [ ] **步骤 3：实现最小 Repository**

在 backend/app/generation_history_repository.py 中实现以下固定接口：

~~~python
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
~~~

created_at 参数只用于 Repository 的确定性测试；HTTP 请求不暴露该字段，路由始终使用默认的服务端时间。

- [ ] **步骤 4：运行 Repository 测试确认通过**

运行：

~~~powershell
cd backend
python -m pytest tests/test_generation_history_repository.py -q
~~~

预期：全部测试通过。

- [ ] **步骤 5：提交 Repository 变更**

~~~powershell
git add backend/app/generation_history_repository.py backend/tests/test_generation_history_repository.py
git commit -m "feat: 增加生成历史仓储"
~~~

---

### 任务 3：实现 FastAPI 历史数据接口

**文件：**

- 新建：backend/app/routes/generation_history.py
- 修改：backend/app/main.py
- 新建：backend/tests/test_generation_history_routes.py

**接口：**

- POST /api/generation-history：新增一条已完成图片的历史记录。
- GET /api/generation-history：返回全部记录。
- GET /api/generation-history?prompt_card_id={id}：只返回指定卡片的记录。
- GET /api/generation-history/{history_id}：返回单条记录。
- DELETE /api/generation-history/{history_id}：删除记录和本地图片。

- [ ] **步骤 1：先写未鉴权、创建、筛选、详情和删除测试**

测试客户端 fixture 使用 tmp_path / data / app.db，并创建 tmp_path / data / generated-images；fixture 插入 ID 为 1 和 2 的两张提示词卡片，并把生成图片目录放入 history_client.app.state.generated_image_directory，方便测试检查文件删除。图片文件使用 write_bytes(b"generated") 创建，不上传 multipart 文件。

fixture 的核心结构如下：

~~~python
@pytest.fixture
def password() -> str:
    return "route-test-password"


@pytest.fixture
def history_client(password: str, tmp_path: Path) -> TestClient:
    data_root = tmp_path / "data"
    data_root.mkdir()
    generated_image_directory = data_root / "generated-images"
    generated_image_directory.mkdir()
    image_directory = data_root / "prompt-images"
    image_directory.mkdir()
    database_path = data_root / "app.db"

    connection = sqlite3.connect(database_path)
    schema = Path(__file__).resolve().parents[1] / "schema.sql"
    connection.executescript(schema.read_text(encoding="utf-8"))
    prompt_cards = PromptCardRepository(connection)
    prompt_cards.create_prompt_card(
        title="测试卡",
        prompt_text="测试提示词",
        example_image_path="prompt-images/example.png",
    )
    prompt_cards.create_prompt_card(
        title="第二张卡",
        prompt_text="第二个提示词",
        example_image_path="prompt-images/example-2.png",
    )
    connection.close()

    settings = Settings(
        auth_password_hash=hash_password(password),
        database_path=database_path,
        image_directory=image_directory,
    )
    application = create_app(settings)
    application.state.generated_image_directory = generated_image_directory
    return TestClient(application)
~~~

在测试文件中定义登录和 API 新增辅助函数：

~~~python
def _login(client: TestClient, password: str) -> str:
    response = client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 200
    return response.json()["token"]


def _create_history_via_api(
    client: TestClient,
    token: str,
    prompt_card_id: int,
    filename: str,
) -> int:
    response = client.post(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "prompt_card_id": prompt_card_id,
            "image_path": f"generated-images/{filename}",
            "model": "Nano Banana 2",
            "aspect_ratio": "4:3",
            "resolution": "1K",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]
~~~

至少加入以下测试：

~~~python
def test_history_routes_require_token(history_client: TestClient) -> None:
    assert history_client.get("/api/generation-history").status_code == 401
    assert history_client.post(
        "/api/generation-history",
        json={
            "prompt_card_id": 1,
            "image_path": "generated-images/one.png",
            "model": "model",
            "aspect_ratio": "4:3",
            "resolution": "1K",
        },
    ).status_code == 401
    assert history_client.get("/api/generation-history/1").status_code == 401
    assert history_client.delete("/api/generation-history/1").status_code == 401


def test_create_history_returns_computed_title_and_url(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)
    history_client.app.state.generated_image_directory.joinpath("one.png").write_bytes(
        b"generated"
    )

    response = history_client.post(
        "/api/generation-history",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "prompt_card_id": 1,
            "image_path": "generated-images/one.png",
            "model": "Nano Banana 2",
            "aspect_ratio": "4:3",
            "resolution": "1K",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["prompt_card_id"] == 1
    assert body["title"].startswith("测试卡 ")
    assert body["image_path"] == "generated-images/one.png"
    assert body["url"] == "/media/generated-images/one.png"
    assert isinstance(body["created_at"], int)


def test_list_history_can_filter_by_prompt_card(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)
    for filename in ("one.png", "two.png"):
        history_client.app.state.generated_image_directory.joinpath(filename).write_bytes(
            filename.encode()
        )
    _create_history_via_api(history_client, token, 1, "one.png")
    _create_history_via_api(history_client, token, 2, "two.png")

    response = history_client.get(
        "/api/generation-history?prompt_card_id=1",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert [item["prompt_card_id"] for item in response.json()["items"]] == [1]


def test_get_missing_history_returns_404(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)

    response = history_client.get(
        "/api/generation-history/999",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404


def test_delete_history_removes_record_and_image(
    history_client: TestClient,
    password: str,
) -> None:
    token = _login(history_client, password)
    image_path = history_client.app.state.generated_image_directory / "delete.png"
    image_path.write_bytes(b"generated")
    history_id = _create_history_via_api(
        history_client,
        token,
        prompt_card_id=1,
        filename="delete.png",
    )

    response = history_client.delete(
        f"/api/generation-history/{history_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    assert not image_path.exists()
    assert history_client.get(
        f"/api/generation-history/{history_id}",
        headers={"Authorization": f"Bearer {token}"},
    ).status_code == 404
~~~

另外覆盖两个输入错误：不存在的 prompt_card_id 返回 404；image_path 为绝对路径、包含 .. 或指向 generated-images 之外时返回 422。

- [ ] **步骤 2：运行路由测试确认先失败**

运行：

~~~powershell
cd backend
python -m pytest tests/test_generation_history_routes.py -q
~~~

预期：失败，因为历史路由尚未注册。

- [ ] **步骤 3：实现请求、响应模型和安全路径解析**

在 backend/app/routes/generation_history.py 中实现以下核心结构：

~~~python
from pathlib import Path
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel

from app.generation_history_repository import (
    GenerationHistory,
    GenerationHistoryRepository,
)
from app.prompt_card_images import MEDIA_URL_PREFIX
from app.prompt_card_repository import PromptCardRepository
from app.routes.auth import require_token

router = APIRouter(prefix="/generation-history", tags=["generation-history"])


class GenerationHistoryCreateRequest(BaseModel):
    prompt_card_id: int
    image_path: str
    model: str
    aspect_ratio: str
    resolution: str


class GenerationHistoryItem(BaseModel):
    id: int
    prompt_card_id: int
    title: str
    image_path: str
    url: str
    model: str
    aspect_ratio: str
    resolution: str
    created_at: int


class GenerationHistoryListResponse(BaseModel):
    items: list[GenerationHistoryItem]


def _generated_root(request: Request) -> Path:
    return (
        Path(request.app.state.settings.database_path).parent
        / "generated-images"
    ).resolve()


def _resolve_generated_image_path(
    request: Request,
    image_path: str,
    *,
    require_file: bool,
) -> Path:
    relative_path = Path(image_path)
    if (
        relative_path.is_absolute()
        or not relative_path.parts
        or relative_path.parts[0] != "generated-images"
        or ".." in relative_path.parts
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid generated image path",
        )

    data_root = Path(request.app.state.settings.database_path).parent.resolve()
    generated_root = _generated_root(request)
    resolved_path = (data_root / relative_path).resolve()
    try:
        resolved_path.relative_to(generated_root)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid generated image path",
        ) from error

    if require_file and not resolved_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Generated image file not found",
        )
    return resolved_path


def _to_item(history: GenerationHistory) -> GenerationHistoryItem:
    image_path = Path(history.image_path).as_posix()
    return GenerationHistoryItem(
        id=history.id,
        prompt_card_id=history.prompt_card_id,
        title=f"{history.prompt_card_title} {history.created_at}",
        image_path=image_path,
        url=f"{MEDIA_URL_PREFIX}/{image_path}",
        model=history.model,
        aspect_ratio=history.aspect_ratio,
        resolution=history.resolution,
        created_at=history.created_at,
    )


@router.post("", response_model=GenerationHistoryItem, status_code=201)
def create_history(
    payload: GenerationHistoryCreateRequest,
    request: Request,
    _: str = Depends(require_token),
) -> GenerationHistoryItem:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        prompt_cards = PromptCardRepository(connection)
        if prompt_cards.get_prompt_card(payload.prompt_card_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Prompt card not found",
            )

        _resolve_generated_image_path(
            request,
            payload.image_path,
            require_file=True,
        )
        repository = GenerationHistoryRepository(connection)
        history_id = repository.create_history(
            prompt_card_id=payload.prompt_card_id,
            image_path=payload.image_path,
            model=payload.model,
            aspect_ratio=payload.aspect_ratio,
            resolution=payload.resolution,
        )
        history = repository.get_history(history_id)
        if history is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="History record was not created",
            )
        return _to_item(history)
    finally:
        connection.close()


@router.get("", response_model=GenerationHistoryListResponse)
def list_history(
    request: Request,
    prompt_card_id: int | None = Query(default=None, ge=1),
    _: str = Depends(require_token),
) -> GenerationHistoryListResponse:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        repository = GenerationHistoryRepository(connection)
        return GenerationHistoryListResponse(
            items=[
                _to_item(history)
                for history in repository.list_histories(prompt_card_id)
            ]
        )
    finally:
        connection.close()


@router.get("/{history_id}", response_model=GenerationHistoryItem)
def get_history(
    history_id: int,
    request: Request,
    _: str = Depends(require_token),
) -> GenerationHistoryItem:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        history = GenerationHistoryRepository(connection).get_history(history_id)
        if history is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="History record not found",
            )
        return _to_item(history)
    finally:
        connection.close()


@router.delete("/{history_id}", status_code=204)
def delete_history(
    history_id: int,
    request: Request,
    _: str = Depends(require_token),
) -> Response:
    connection = sqlite3.connect(request.app.state.settings.database_path)
    try:
        repository = GenerationHistoryRepository(connection)
        history = repository.get_history(history_id)
        if history is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="History record not found",
            )

        image_path = _resolve_generated_image_path(
            request,
            history.image_path,
            require_file=False,
        )
        try:
            image_path.unlink(missing_ok=True)
        except OSError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Generated image could not be deleted",
            ) from error

        if not repository.delete_history(history_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="History record not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    finally:
        connection.close()
~~~

路由实现要点：

- POST 先确认 prompt_card_id 存在，再校验已保存的图片文件，调用 Repository 新增并返回 201。
- GET 列表把可选查询参数声明为 prompt_card_id: int | None = Query(default=None, ge=1)，不传时传入 None。
- GET 详情找不到记录返回 404。
- DELETE 先取记录并安全解析路径，删除存在的图片，再删除数据库记录；图片不存在时继续删除数据库记录，成功返回 204。
- 所有路由参数都通过 Depends(require_token) 鉴权。

- [ ] **步骤 4：在应用中注册历史路由**

在 backend/app/main.py 增加导入和注册：

~~~python
from app.routes.generation_history import router as generation_history_router

application.include_router(generation_history_router, prefix="/api")
~~~

保留现有 auth_router、welcome_router 和 prompt_cards_router 注册，不修改它们的路径。

- [ ] **步骤 5：运行路由测试确认通过**

运行：

~~~powershell
cd backend
python -m pytest tests/test_generation_history_routes.py -q
~~~

预期：全部历史路由测试通过。

- [ ] **步骤 6：提交 API 变更**

~~~powershell
git add backend/app/routes/generation_history.py backend/app/main.py backend/tests/test_generation_history_routes.py
git commit -m "feat: 提供生成历史数据 API"
~~~

---

### 任务 4：全量验证并确认范围

**文件：**

- 不新增业务文件；只检查任务 1 至任务 3 的变更。

- [ ] **步骤 1：运行全部后端测试**

运行：

~~~powershell
cd backend
python -m pytest -q
~~~

预期：现有测试和新增历史 API 测试全部通过。

- [ ] **步骤 2：运行 Python 编译检查**

运行：

~~~powershell
cd backend
python -m compileall -q app tests
~~~

预期：命令成功且没有语法错误。

- [ ] **步骤 3：检查差异和范围**

运行：

~~~powershell
git diff --check
git status --short
~~~

确认只包含历史 API 的后端代码、测试、schema、迁移和计划/设计文档；不得出现前端页面、参考图字段、批次表、任务状态或新依赖。

- [ ] **步骤 4：提交最终验证结果**

如果前面任务提交后仍有验证修正，只提交对应的后端测试或实现修正：

~~~powershell
git add backend/schema.sql backend/migrations/2026-08-02-add-generation-history.sql backend/app/generation_history_repository.py backend/app/routes/generation_history.py backend/app/main.py backend/tests/test_database.py backend/tests/test_generation_history_repository.py backend/tests/test_generation_history_routes.py
git commit -m "test: 验证生成历史 API"
~~~

## 计划自审

- 数据库表、迁移、Repository、路由注册、四个接口、卡片筛选、计算标题、文件删除和鉴权均有对应任务。
- 计划没有加入历史页面、提示词快照、参考图、批次、状态、分页或其他筛选。
- 所有 Repository 方法名、数据类字段和 API 响应字段在任务之间保持一致。
- 计划不存在未定义的实现占位符。
