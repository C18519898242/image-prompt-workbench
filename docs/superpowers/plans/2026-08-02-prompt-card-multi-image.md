# 提示词卡片多图展示实现计划

> **面向代理式执行者：** 实现此计划时必须逐任务使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。每个任务使用复选框跟踪，并在每个任务完成后运行对应测试。

**目标：** 在不增加图片子表的前提下，让一个提示词卡片支持多张 JPG 或 PNG 示例图片，并在前端以“首图加数量、详情轮播”的方式完整展示。

**架构：** 数据库在现有 prompt_cards 表中增加 image_count，继续用 example_image_path 保存第一张图片。后端根据第一张图片的文件名、扩展名和数量推导其他图片，并提供受 Bearer Token 保护的卡片列表和图片接口；前端通过带 Token 的 fetch 获取图片对象 URL，在固定展示区域内使用 contain 轮播。

**技术栈：** Python 3、SQLite、FastAPI、pytest、React、TypeScript、Vite、Vitest、React Testing Library。

## 全局约束

- 所有新增或修改的文档内容必须使用中文。
- 不增加 prompt_card_images 或其他图片子表。
- 数据库只新增 image_count；example_image_path 继续保存第一张图片的相对路径。
- 同一卡片默认使用同一种 JPG 或 PNG 扩展名；发现混合扩展名时只打印警告，不转换格式，不中止导入。
- 重复导入、去重、已有卡片更新、文件覆盖策略不属于本任务。
- 图片必须完整显示，使用 contain，不裁剪、不拉伸；允许出现留白。
- 现有 Bearer Token 鉴权必须覆盖卡片列表接口和图片接口。
- 每个任务先补充失败测试，再实现最小改动，最后运行任务对应的测试并提交独立 commit。

---

## 文件边界

本计划涉及的文件及职责如下：

- 修改 backend/schema.sql：为新建数据库加入 image_count 字段。
- 新建 backend/migrations/2026-08-02-add-image-count.sql：为已有 SQLite 数据库增加 image_count。
- 修改 backend/app/prompt_card_repository.py：扩展 PromptCard 数据类以及创建、查询、更新方法。
- 修改 backend/app/import_prompt_cards.py：写入图片数量，并对同一卡片的混合扩展名输出警告。
- 修改 backend/app/config.py：提供数据库和图片目录配置。
- 新建 backend/app/prompt_card_images.py：集中处理图片文件名推导、路径安全和媒体类型。
- 新建 backend/app/routes/prompt_cards.py：提供卡片列表和单张图片接口。
- 修改 backend/app/main.py：挂载提示词卡片路由并保存应用设置。
- 修改 backend/tests/test_database.py：验证 schema 中的新字段。
- 修改 backend/tests/test_prompt_card_repository.py：验证 image_count 的读写和默认值。
- 修改 backend/tests/test_import_prompt_cards.py：验证多图数量和混合扩展名警告。
- 新建 backend/tests/test_prompt_card_images.py：验证图片文件名推导和路径边界。
- 新建 backend/tests/test_prompt_card_routes.py：验证卡片 API、图片 API 和鉴权。
- 修改 frontend/src/api.ts：增加卡片类型、卡片列表请求和带 Token 的图片请求。
- 新建 frontend/src/components/PromptCardBrowser.tsx：加载卡片列表并管理列表页状态。
- 新建 frontend/src/components/PromptCardCard.tsx：渲染首图、数量标记、标题和摘要。
- 新建 frontend/src/components/PromptCardDialog.tsx：渲染完整提示词和图片轮播。
- 修改 frontend/src/components/WelcomeView.tsx：登录后的欢迎区域挂载提示词卡片浏览器。
- 修改 frontend/src/index.css：增加卡片网格、图片展示框和弹窗轮播样式。
- 新建 frontend/src/components/PromptCardBrowser.test.tsx：验证列表、数量标记、弹窗和轮播。
- 修改 frontend/src/App.test.tsx：为登录后的卡片请求补充响应，并保留现有会话竞态测试。
- 修改 README.md：补充已有数据库迁移命令和多图导入说明。

---

### 任务 1：增加图片数量字段和仓储层支持

**文件：**

- 修改：backend/schema.sql
- 新建：backend/migrations/2026-08-02-add-image-count.sql
- 修改：backend/app/prompt_card_repository.py
- 修改：backend/tests/test_database.py
- 修改：backend/tests/test_prompt_card_repository.py

**接口：**

- PromptCard 增加 image_count: int。
- create_prompt_card 增加关键字参数 image_count: int = 1。
- update_prompt_card 增加关键字参数 image_count: int = 1。
- get_prompt_card 和 list_prompt_cards 返回 image_count。

- [ ] **步骤 1：先写失败测试**

在 test_database.py 的字段断言中加入：

~~~python
"image_count": ("INTEGER", 1, "1"),
~~~

同时增加已有数据库迁移测试：

~~~python
def test_image_count_migration_adds_default_to_existing_table() -> None:
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE prompt_cards (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            prompt_text TEXT NOT NULL,
            example_image_path TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO prompt_cards
        (title, prompt_text, example_image_path)
        VALUES ('旧卡片', '旧提示词', 'prompt-images/0001-01.jpg');
        """
    )

    migration = Path(
        __file__
    ).resolve().parents[1] / "migrations/2026-08-02-add-image-count.sql"
    connection.executescript(migration.read_text(encoding="utf-8"))

    assert connection.execute(
        "SELECT image_count FROM prompt_cards WHERE id = 1"
    ).fetchone() == (1,)
    connection.close()
~~~

在 test_prompt_card_repository.py 增加以下两个测试：

~~~python
def test_create_and_get_prompt_card_preserves_image_count(
    repository: PromptCardRepository,
) -> None:
    card_id = repository.create_prompt_card(
        title="多图卡片",
        prompt_text="完整提示词",
        example_image_path="prompt-images/0001-01.jpg",
        image_count=3,
    )

    card = repository.get_prompt_card(card_id)

    assert card is not None
    assert card.image_count == 3


def test_create_prompt_card_defaults_to_one_image(
    repository: PromptCardRepository,
) -> None:
    card_id = repository.create_prompt_card(
        title="单图卡片",
        prompt_text="完整提示词",
        example_image_path="prompt-images/0002-01.png",
    )

    card = repository.get_prompt_card(card_id)

    assert card is not None
    assert card.image_count == 1
~~~

- [ ] **步骤 2：运行测试确认失败**

运行：

~~~powershell
cd backend
python -m pytest tests/test_database.py tests/test_prompt_card_repository.py -q
~~~

预期：失败，原因包括 schema 缺少 image_count、PromptCard 没有 image_count 属性或仓储方法不接受 image_count。

- [ ] **步骤 3：实现 schema、迁移和仓储层**

在 backend/schema.sql 的 prompt_cards 表中，将字段定义加入 updated_at 之前：

~~~sql
image_count INTEGER NOT NULL DEFAULT 1 CHECK (image_count > 0),
~~~

创建 backend/migrations/2026-08-02-add-image-count.sql，内容为：

~~~sql
ALTER TABLE prompt_cards
ADD COLUMN image_count INTEGER NOT NULL DEFAULT 1
CHECK (image_count > 0);
~~~

在 PromptCard 数据类中加入 image_count: int。create_prompt_card 和 update_prompt_card 在执行 SQL 前把 image_count 转换为 int；小于 1 时抛出 ValueError("image_count must be positive")。INSERT、UPDATE、SELECT 和 _to_prompt_card 必须同时包含 image_count。

INSERT 的字段和参数必须对应以下结构：

~~~sql
INSERT INTO prompt_cards
(title, prompt_text, example_image_path, image_count, sort_order)
VALUES (?, ?, ?, ?, ?)
~~~

UPDATE 必须同时更新 example_image_path 和 image_count，但不改变 created_at。

- [ ] **步骤 4：运行测试确认通过**

运行：

~~~powershell
cd backend
python -m pytest tests/test_database.py tests/test_prompt_card_repository.py -q
~~~

预期：数据库和仓储测试全部通过。

- [ ] **步骤 5：提交**

~~~powershell
git add backend/schema.sql backend/migrations/2026-08-02-add-image-count.sql backend/app/prompt_card_repository.py backend/tests/test_database.py backend/tests/test_prompt_card_repository.py
git commit -m "feat: 增加提示词卡片图片数量"
~~~

---

### 任务 2：让导入器保存数量并记录格式警告

**文件：**

- 修改：backend/app/import_prompt_cards.py
- 修改：backend/tests/test_import_prompt_cards.py

**接口：**

- import_prompt_cards 继续返回导入卡片数量。
- 每个成功导入的卡片把 len(card.image_urls) 传给 repository.create_prompt_card 的 image_count。
- 新增内部函数 _warn_if_mixed_image_extensions(card_number: int, image_urls: tuple[str, ...]) -> None；该函数比较同一卡片所有图片的后缀，并在后缀集合超过一个时记录 warning。

- [ ] **步骤 1：先写失败测试**

在现有远程导入测试中，读取卡片后断言：

~~~python
assert card.image_count == 2
~~~

增加一个使用 caplog 的测试，准备同一卡片包含 one.jpg 和 two.png 的 README，调用 import_prompt_cards(progress=False)，并断言：

~~~python
assert "第 1 张卡片图片扩展名不一致" in caplog.text
~~~

同时断言导入返回数量仍为 1，证明警告不会中止导入。

- [ ] **步骤 2：运行测试确认失败**

运行：

~~~powershell
cd backend
python -m pytest tests/test_import_prompt_cards.py -q
~~~

预期：失败，原因是 PromptCard 没有正确保存 image_count，且当前没有混合扩展名警告。

- [ ] **步骤 3：实现最小改动**

在 import_prompt_cards 的每张卡片处理逻辑中，完成图片 URL 校验后计算：

~~~python
image_count = len(card.image_urls)
_warn_if_mixed_image_extensions(card_number, card.image_urls)
~~~

调用 repository.create_prompt_card 时传入 image_count=image_count。

使用标准 logging：

~~~python
logger = logging.getLogger(__name__)


def _warn_if_mixed_image_extensions(
    card_number: int,
    image_urls: tuple[str, ...],
) -> None:
    extensions = {
        Path(urlparse(image_url).path).suffix.lower()
        for image_url in image_urls
    }
    if len(extensions) > 1:
        logger.warning(
            "第 %d 张卡片图片扩展名不一致：%s",
            card_number,
            ", ".join(sorted(extensions)),
        )
~~~

空扩展名不需要转换；它只参与现有文件名规则。不要新增格式转换逻辑，也不要改变重复导入行为。

- [ ] **步骤 4：运行测试确认通过**

运行：

~~~powershell
cd backend
python -m pytest tests/test_import_prompt_cards.py -q
~~~

预期：导入测试全部通过，混合扩展名测试出现 warning 但没有失败。

- [ ] **步骤 5：提交**

~~~powershell
git add backend/app/import_prompt_cards.py backend/tests/test_import_prompt_cards.py
git commit -m "feat: 导入提示词卡片图片数量"
~~~

---

### 任务 3：提供图片路径推导和受保护的后端接口

**文件：**

- 修改：backend/app/config.py
- 新建：backend/app/prompt_card_images.py
- 新建：backend/app/routes/prompt_cards.py
- 修改：backend/app/main.py
- 新建：backend/tests/test_prompt_card_images.py
- 新建：backend/tests/test_prompt_card_routes.py

**接口：**

- Settings 增加：

~~~python
database_path: Path
image_directory: Path
~~~

默认值分别为项目根目录下的 data/app.db 和 data/prompt-images，并允许通过环境变量覆盖。

- prompt_card_images.py 提供 derive_image_paths(example_image_path: str, image_count: int, image_directory: Path) -> list[Path] 和 get_image_media_type(path: Path) -> str。

- GET /api/prompt-cards 返回：

~~~json
{
  "items": [
    {
      "id": 1,
      "title": "卡片标题",
      "prompt_text": "完整提示词",
      "sort_order": 1,
      "category_ids": [],
      "image_count": 2,
      "images": [
        {"index": 1, "url": "/api/prompt-cards/1/images/1"},
        {"index": 2, "url": "/api/prompt-cards/1/images/2"}
      ]
    }
  ]
}
~~~

- GET /api/prompt-cards/{card_id}/images/{image_index} 返回实际 JPG/PNG 文件。

- [ ] **步骤 1：先写失败测试**

在 test_prompt_card_images.py 覆盖以下输入：

~~~python
def test_derive_image_paths_uses_first_extension(tmp_path: Path) -> None:
    paths = derive_image_paths(
        "prompt-images/0001-01.jpg",
        2,
        tmp_path,
    )

    assert paths == [
        tmp_path / "0001-01.jpg",
        tmp_path / "0001-02.jpg",
    ]


def test_derive_image_paths_rejects_non_positive_count(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="image_count"):
        derive_image_paths("prompt-images/0001-01.jpg", 0, tmp_path)
~~~

在 test_prompt_card_routes.py 创建临时数据库和图片目录，写入一张 image_count=2 的卡片及两个 JPG 文件，覆盖：

- 登录后 GET /api/prompt-cards 返回 200、image_count 为 2、images 长度为 2；
- 登录后 GET /api/prompt-cards/1/images/2 返回 200，响应内容为第二张文件；
- GET /api/prompt-cards/1/images/3 返回 404；
- 不带 Token 请求列表和图片接口均返回 401。

- [ ] **步骤 2：运行测试确认失败**

运行：

~~~powershell
cd backend
python -m pytest tests/test_prompt_card_images.py tests/test_prompt_card_routes.py -q
~~~

预期：失败，原因是设置字段、图片推导模块和路由尚未存在。

- [ ] **步骤 3：实现配置、图片推导和路由**

在 config.py 中使用 pathlib.Path 定义项目根目录，并为 Settings 增加 database_path 和 image_directory 默认值。main.py 创建应用时把 resolved_settings 保存到 application.state.settings，并 include_router(prompt_cards_router, prefix="/api")。

derive_image_paths 必须只使用 example_image_path 的文件名部分作为命名模板：取最后一个连字符前的前缀、第一张图片的两位序号和小写扩展名，再按 01 到 image_count 生成路径。扩展名只允许 .jpg 和 .png；其他扩展名抛出 ValueError。image_directory 必须是最终路径的根目录，不能把数据库字段中的目录部分直接拼接到文件系统根路径上。

图片推导逻辑应等价于：

~~~python
first_name = Path(example_image_path).name
first_path = Path(first_name)
prefix, separator, first_index = first_path.stem.rpartition("-")
if separator != "-" or first_index != "01":
    raise ValueError("example_image_path must end with -01")
suffix = first_path.suffix.lower()
if suffix not in {".jpg", ".png"}:
    raise ValueError("unsupported image extension")
return [
    image_directory / f"{prefix}-{index:02d}{suffix}"
    for index in range(1, image_count + 1)
]
~~~

路由使用 require_token 作为 Depends。列表路由每次请求打开 Settings.database_path 的 SQLite 连接，调用 PromptCardRepository.list_prompt_cards()，为每张卡片构造 images 数组后关闭连接。图片路由查询卡片、检查 image_index 范围、推导路径、确认文件存在，再用 FileResponse 返回文件；找不到卡片、路径格式不合法或文件不存在均返回 404。

- [ ] **步骤 4：运行测试确认通过**

运行：

~~~powershell
cd backend
python -m pytest tests/test_prompt_card_images.py tests/test_prompt_card_routes.py -q
~~~

预期：推导、API 状态码、响应内容和鉴权测试全部通过。

- [ ] **步骤 5：提交**

~~~powershell
git add backend/app/config.py backend/app/prompt_card_images.py backend/app/routes/prompt_cards.py backend/app/main.py backend/tests/test_prompt_card_images.py backend/tests/test_prompt_card_routes.py
git commit -m "feat: 增加提示词卡片图片接口"
~~~

---

### 任务 4：实现前端卡片列表和详情轮播

**文件：**

- 修改：frontend/src/api.ts
- 新建：frontend/src/components/PromptCardBrowser.tsx
- 新建：frontend/src/components/PromptCardCard.tsx
- 新建：frontend/src/components/PromptCardDialog.tsx
- 修改：frontend/src/components/WelcomeView.tsx
- 修改：frontend/src/index.css
- 新建：frontend/src/components/PromptCardBrowser.test.tsx
- 修改：frontend/src/App.test.tsx

**接口：**

在 api.ts 中新增以下类型和函数：

~~~typescript
export type PromptCardImage = {
  index: number;
  url: string;
};

export type PromptCard = {
  id: number;
  title: string;
  prompt_text: string;
  sort_order: number;
  category_ids: number[];
  image_count: number;
  images: PromptCardImage[];
};

export async function getPromptCards(token: string): Promise<PromptCard[]>;
export async function fetchImageObjectUrl(
  token: string,
  url: string,
): Promise<string>;
~~~

- [ ] **步骤 1：先写失败测试**

在 PromptCardBrowser.test.tsx 中使用 fetch mock 返回一张包含两张图片的卡片，并覆盖：

~~~tsx
test("显示首图和图片数量", async () => {
  render(<PromptCardBrowser token="token-1" />);

  expect(await screen.findByText("共 2 张")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "多图卡片" })).toBeInTheDocument();
});

test("点击卡片后显示轮播和完整提示词", async () => {
  const user = userEvent.setup();
  render(<PromptCardBrowser token="token-1" />);

  await user.click(await screen.findByRole("button", { name: "多图卡片" }));

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("完整提示词内容")).toBeInTheDocument();
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
});

test("点击下一张后显示第二张序号", async () => {
  const user = userEvent.setup();
  render(<PromptCardBrowser token="token-1" />);

  await user.click(await screen.findByRole("button", { name: "多图卡片" }));
  await user.click(screen.getByRole("button", { name: "下一张" }));

  expect(screen.getByText("2 / 2")).toBeInTheDocument();
});
~~~

在 App.test.tsx 的成功登录场景中，为 welcome 请求之后的 prompt-cards 请求补充 JSON 响应；现有 stale token 测试必须继续验证旧请求的 401 不会清除新 Token。

- [ ] **步骤 2：运行测试确认失败**

运行：

~~~powershell
cd frontend
npm test -- --run
~~~

预期：新增组件测试因组件、类型和 API 函数尚不存在而失败；现有 App 测试在新增请求响应未补齐前也会失败。

- [ ] **步骤 3：实现 API 类型、图片对象 URL 和组件**

getPromptCards 使用现有 parseResponse 和 Authorization: Bearer 加 token 的请求头，发送 GET /api/prompt-cards。fetchImageObjectUrl 使用同样的 Authorization 请求图片 URL，检查 response.ok，读取 response.blob()，通过 URL.createObjectURL 返回对象 URL；非 2xx 响应抛出 ApiError。

PromptCardBrowser 负责：加载卡片列表、显示加载和错误状态、记录当前打开的卡片、在收到 401 时调用 useAuth().clearToken(token)，以及在组件卸载时释放所有对象 URL。列表只预加载每张卡片的第 1 张图片；弹窗打开后按需加载当前图片和缩略图。

PromptCardCard 必须使用可访问的 button 作为卡片点击入口，渲染首图、标题、提示词摘要和 image_count 大于 1 时的“共 N 张”标记。图片加载失败时显示占位内容，不能隐藏标题和提示词摘要。

PromptCardDialog 必须提供 role="dialog"、关闭按钮、左右切换按钮、当前序号/总数、缩略图按钮、完整提示词和“立即尝试”入口。当前图片的展示框尺寸固定，图片使用 object-fit: contain；不要使用 object-fit: cover。

WelcomeView 保留现有欢迎消息和退出登录能力，并在欢迎请求成功后渲染 PromptCardBrowser。这样不改变当前认证边界，登录后的主内容变为提示词卡片浏览器。

在 index.css 中加入以下关键规则：

~~~css
.prompt-card-image-frame,
.prompt-card-stage {
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #e5e7eb;
}

.prompt-card-image,
.prompt-card-stage img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
~~~

卡片网格在窄屏下改为单列；弹窗内容不得因图片横竖比例切换而改变外层高度。

- [ ] **步骤 4：运行测试确认通过**

运行：

~~~powershell
cd frontend
npm test -- --run
npm run build
~~~

预期：Vitest 全部通过，TypeScript 编译和 Vite 构建退出码为 0。

- [ ] **步骤 5：提交**

~~~powershell
git add frontend/src/api.ts frontend/src/components/PromptCardBrowser.tsx frontend/src/components/PromptCardCard.tsx frontend/src/components/PromptCardDialog.tsx frontend/src/components/WelcomeView.tsx frontend/src/index.css frontend/src/components/PromptCardBrowser.test.tsx frontend/src/App.test.tsx
git commit -m "feat: 增加提示词卡片多图轮播"
~~~

---

### 任务 5：补充使用说明并完成全量验证

**文件：**

- 修改：README.md
- 不新增业务代码。

**接口：**

- README 必须说明新建数据库和已有数据库的不同操作。
- README 必须说明一个卡片的图片文件命名、image_count、首图加数量和详情轮播行为。
- README 必须明确重复导入仍不在本任务处理范围内。

- [ ] **步骤 1：更新中文 README**

在数据库初始化说明后增加已有数据库迁移命令：

~~~powershell
sqlite3 data/app.db < backend/migrations/2026-08-02-add-image-count.sql
~~~

同时明确：全新数据库直接使用更新后的 backend/schema.sql，不重复执行迁移文件；已有数据库只执行一次迁移。

在导入提示词卡片章节补充：

~~~text
一个卡片的图片按照 0001-01.jpg、0001-02.jpg 的顺序保存。
数据库使用第一张图片路径和 image_count 记录多图关系。
列表页显示第一张图片和图片总数，点击后在详情轮播中完整查看图片。
同一卡片 JPG/PNG 混用时当前只打印警告，不做格式转换。
重复导入策略暂不处理。
~~~

- [ ] **步骤 2：运行完整验证**

运行后端完整测试：

~~~powershell
cd backend
python -m pytest -q
~~~

运行前端完整测试和构建：

~~~powershell
cd frontend
npm test -- --run
npm run build
~~~

从项目根目录检查 diff：

~~~powershell
git diff --check
git status --short
~~~

预期：后端和前端测试全部通过，前端构建成功，diff --check 没有空白错误。确认工作区中只包含本任务预期文件和用户已有改动，不暂存 .idea/ 或运行时数据。

- [ ] **步骤 3：提交**

~~~powershell
git add README.md
git commit -m "docs: 补充提示词卡片多图说明"
~~~

---

## 实现后的验收清单

- [ ] 新数据库包含 image_count，旧数据库执行一次迁移后可读取旧卡片。
- [ ] 单图卡片默认 image_count 为 1。
- [ ] 多图卡片保存正确数量，第一张路径仍是 example_image_path。
- [ ] JPG 和 PNG 单格式卡片均能通过 API 返回全部图片。
- [ ] 混合扩展名只产生警告，不触发格式转换或导入失败。
- [ ] 卡片列表显示首图和“共 N 张”。
- [ ] 详情弹窗显示完整提示词、轮播、缩略图和序号。
- [ ] 图片横竖比例不同不会被裁剪、拉伸或造成布局跳动。
- [ ] 卡片和图片接口均需要有效 Bearer Token。
- [ ] 缺图时图片显示占位状态，文字内容仍可见。
- [ ] 重复导入行为没有被本任务扩展或改变。
