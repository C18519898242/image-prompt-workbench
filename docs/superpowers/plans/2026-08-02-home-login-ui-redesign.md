# 首页提示词库与登录页 UI 重设计实现计划

> **面向代理式执行者：** 实现此计划时必须逐任务使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。每个任务使用复选框（`- [ ]`）跟踪进度。

**目标：** 按设计文档将登录页与首页（提示词库）改造成浅色 AI 创作工作台风格，首页只负责浏览/筛选/选择提示词，登录页只保留单密码登录。

**架构：** 前端以 App 内视图状态切换（`login` / `library` / `workspace-placeholder`），不引入路由库。登录后进入「提示词库」全页布局（顶栏 + 工具条 + 卡片网格）。分类与搜索/排序先在前端完成；收藏使用 `localStorage`。点击「使用此提示词」进入生成工作台占位页（带入卡片 id），完整生成工作台与历史页不在本计划范围。

**技术栈：** React、TypeScript、Vite、Vitest、React Testing Library、现有 FastAPI 卡片列表 API、可选扩展分类列表 API。

**设计依据：** `docs/superpowers/specs/2026-08-02-image-prompt-workbench-ui-redesign-design.md` 第 2、7、11.1、12 节；视觉稿 `docs/superpowers/specs/assets/image-prompt-workbench-prompt-library.png`、`image-prompt-workbench-login.png`。

---

## 全局约束

- 所有新增或修改的文档内容必须使用中文。
- **本计划只改登录页与首页（提示词库）**；完整生成工作台、生成历史页、生图 API 不实现。
- 首页**不出现**：提示词编辑器、生成参考图、生成参数、生成结果、生成历史列表。
- 不出现社区、作者、点赞、评论、分享、注册、社交登录、「记住我」、营销入口。
- 删除卡片详情弹窗中指向 YouMind 的「立即生成」外链；入口改为「使用此提示词」。
- 视觉：浅色、白底、浅灰细边框、黑色主按钮、小圆角、轻阴影；封面图固定 **4:3**，图片 `object-fit: contain`，不裁剪不拉伸。
- 测试中禁止硬编码明文密码；继续用运行时随机密码。
- 每个任务：先写失败测试 → 实现最小改动 → 跑通测试 → 独立 commit。

---

## 范围边界

### 本计划包含

| 能力 | 说明 |
| --- | --- |
| 登录页视觉与文案 | 居中卡片、产品名、副标题、密码框、黑色「登录」、内联错误、页脚「仅供个人使用」 |
| 提示词库顶栏 | 产品标识、「提示词库」当前页、「生成工作台」「历史」占位入口、「设置/退出」 |
| 搜索 / 排序 / 分类筛选 | 前端对已加载卡片过滤；分类无数据时仅显示「全部」 |
| 收藏 | `localStorage` 存卡片 id 列表；「收藏」筛选与卡片收藏切换 |
| 卡片网格 | 4:3 封面、标题、分类标签、摘要、「使用此提示词」 |
| 使用此提示词 | 切换到工作台占位页，携带 `cardId`；不自动把示例图当参考图 |
| 分类 API（轻量） | `GET /api/categories` + 卡片响应附带 `categories: {id,name}[]`，便于标签展示 |

### 本计划不包含

- 生成工作台真实布局与生成逻辑
- 生成历史页
- 分类数据导入/种子数据
- 服务端收藏、记住登录、注册
- 移动端专项布局

---

## 文件边界

| 文件 | 职责 |
| --- | --- |
| 修改 `frontend/src/index.css` | 设计 token + 登录页 + 提示词库布局/卡片样式 |
| 修改 `frontend/src/components/LoginForm.tsx` | 登录页结构与类名 |
| 新建 `frontend/src/components/LoginForm.test.tsx` | 登录页文案与错误展示 |
| 修改 `frontend/src/components/WelcomeView.tsx` → 重构为 `AppShell` 或保留并改成壳 | 登录后壳层：顶栏 + 当前视图 |
| 新建 `frontend/src/components/AppShell.tsx` | 顶栏导航 + 子视图出口 |
| 新建 `frontend/src/components/PromptLibraryPage.tsx` | 提示词库页：工具条 + 网格 + 状态 |
| 修改 `frontend/src/components/PromptCardBrowser.tsx` | 抽离列表逻辑或改为被 Library 使用；去掉旧弹窗入口作为主交互 |
| 修改 `frontend/src/components/PromptCardCard.tsx` | 标签、「使用此提示词」、收藏按钮；卡片不再整卡打开弹窗为主 CTA |
| 修改或精简 `frontend/src/components/PromptCardDialog.tsx` | 可选保留「仅预览」；去掉 YouMind 外链 |
| 新建 `frontend/src/components/WorkspacePlaceholder.tsx` | 生成工作台占位（标题 + 返回 + 显示已选卡片标题/id） |
| 新建 `frontend/src/lib/favorites.ts` | localStorage 收藏读写 |
| 新建 `frontend/src/lib/favorites.test.ts` | 收藏工具单测 |
| 修改 `frontend/src/api.ts` | `Category`、`PromptCard.categories`、`getCategories` |
| 修改 `frontend/src/App.tsx` | 挂载壳层 |
| 修改 `frontend/src/App.test.tsx` | 适配新文案与布局断言 |
| 修改 `frontend/src/components/PromptCardBrowser.test.tsx` | 适配新卡片交互 |
| 新建 `frontend/src/components/PromptLibraryPage.test.tsx` | 搜索/筛选/使用提示词 |
| 修改 `backend/app/routes/prompt_cards.py` | 列表项带 categories；新增 categories 接口 |
| 修改 `backend/tests/test_prompt_card_routes.py` | 分类字段与接口测试 |

---

## 共享接口与约定

### 视图状态（App 层）

```ts
type AppView =
  | { name: "library" }
  | { name: "workspace"; cardId: number | null }
  | { name: "history-placeholder" }
  | { name: "settings-placeholder" };
```

未登录只渲染 `LoginForm`。登录后默认 `{ name: "library" }`。

### 提示词库筛选状态（页内）

```ts
type LibraryFilters = {
  query: string;
  categoryId: number | null; // null = 全部
  sort: "newest" | "oldest" | "title";
  favoritesOnly: boolean;
};
```

从工作台占位返回库时，**同一会话内保留** `LibraryFilters` 与滚动位置（存在 `PromptLibraryPage` 父级或 `AppShell` state，不卸载库页时用条件渲染隐藏，或把 filters 提升到 `AppShell`）。

推荐实现：**filters 提升到 `AppShell`**，库页与工作台切换时不丢失；滚动位置用 `sessionStorage` 键 `prompt-library-scroll-y` 在离开/返回时读写。

### API 类型扩展

```ts
export type Category = {
  id: number;
  name: string;
  sort_order: number;
};

export type PromptCard = {
  id: number;
  title: string;
  prompt_text: string;
  sort_order: number;
  category_ids: number[];
  categories: Category[]; // 新增：展示用，可为空数组
  image_count: number;
  example_image_path: string;
  images: PromptCardImage[];
};
```

### 收藏存储

```ts
// key: "ipw.favorites"
// value: JSON number[] 卡片 id
```

### 视觉 token（CSS 变量）

```css
:root {
  --color-bg: #f7f7f8;
  --color-surface: #ffffff;
  --color-border: #e5e7eb;
  --color-text: #111827;
  --color-text-muted: #6b7280;
  --color-primary: #111827;
  --color-primary-text: #ffffff;
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --shadow-card: 0 1px 2px rgb(15 23 42 / 6%);
}
```

---

### 任务 1：设计 token 与登录页视觉结构

**文件：**

- 修改：`frontend/src/index.css`
- 修改：`frontend/src/components/LoginForm.tsx`
- 新建：`frontend/src/components/LoginForm.test.tsx`
- 修改：`frontend/src/App.test.tsx`（仅保证登录文案断言仍通过）

- [ ] **步骤 1：写失败测试**

新建 `frontend/src/components/LoginForm.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import { LoginForm } from "./LoginForm";

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test("登录页展示产品名、副标题与个人使用说明", () => {
  renderLogin();
  expect(
    screen.getByRole("heading", { name: "Image Prompt Workbench" }),
  ).toBeInTheDocument();
  expect(screen.getByText("个人图像提示词与生成工作台")).toBeInTheDocument();
  expect(screen.getByText("仅供个人使用")).toBeInTheDocument();
  expect(screen.getByLabelText("密码")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  expect(screen.queryByText(/注册|GitHub|Google|记住我/i)).not.toBeInTheDocument();
});

test("登录失败时在表单内显示错误", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }),
  );
  const user = userEvent.setup();
  renderLogin();
  await user.type(screen.getByLabelText("密码"), crypto.randomUUID());
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("密码错误");
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
cd frontend
npm test -- src/components/LoginForm.test.tsx
```

预期：副标题/页脚文案缺失导致 FAIL。

- [ ] **步骤 3：实现登录页结构与样式**

`LoginForm.tsx` 目标结构：

```tsx
return (
  <main className="login-page">
    <div className="login-card">
      <div className="login-logo" aria-hidden="true">
        {/* 简洁 SVG 烧瓶/烧杯图标，避免外链图片 */}
      </div>
      <h1 className="login-title">Image Prompt Workbench</h1>
      <p className="login-subtitle">个人图像提示词与生成工作台</p>
      <form className="login-form" onSubmit={handleSubmit}>
        <label htmlFor="password">密码</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          placeholder="请输入密码"
          required
        />
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "登录中..." : "登录"}
        </button>
      </form>
    </div>
    <p className="login-footer">仅供个人使用</p>
  </main>
);
```

在 `index.css` 增加：

- `:root` 变量（见上文）
- `.login-page`：全视口居中，背景 `--color-bg`
- `.login-card`：白底、细边框、轻阴影、约 `max-width: 24rem`、内边距
- `.btn-primary`：黑底白字全宽
- 错误文案紧贴输入框下方（内联，非全局 toast）

- [ ] **步骤 4：跑测试**

```bash
cd frontend
npm test -- src/components/LoginForm.test.tsx src/App.test.tsx
```

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add frontend/src/components/LoginForm.tsx frontend/src/components/LoginForm.test.tsx frontend/src/index.css frontend/src/App.test.tsx
git commit -m "feat(ui): 重设计单密码登录页为浅色工作台风格"
```

---

### 任务 2：分类 API 与卡片响应附带分类名

**文件：**

- 修改：`backend/app/routes/prompt_cards.py`
- 修改：`backend/tests/test_prompt_card_routes.py`
- 修改：`frontend/src/api.ts`

说明：当前 DB 中 `categories` 可能为空；接口仍返回空数组，前端 UI 只显示「全部」。

- [ ] **步骤 1：写失败测试**

在 `backend/tests/test_prompt_card_routes.py` 增加：

```python
def test_list_categories_requires_auth(client) -> None:
    response = client.get("/api/categories")
    assert response.status_code == 401


def test_list_categories_returns_items(client, auth_headers, repository) -> None:
    # 使用现有 fixture 模式创建分类；若测试文件无 repository fixture，
    # 则通过 conftest 里的临时库 + 直接 SQL/仓库写入。
    category_id = repository.create_category("风景", sort_order=1)
    response = client.get("/api/categories", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert any(item["id"] == category_id and item["name"] == "风景" for item in body["items"])


def test_list_prompt_cards_includes_categories(client, auth_headers, repository) -> None:
    category_id = repository.create_category("科技", sort_order=0)
    card_id = repository.create_prompt_card(
        title="测试卡",
        prompt_text="提示词",
        example_image_path="prompt-images/0001-01.jpg",
        category_ids=[category_id],
    )
    response = client.get("/api/prompt-cards", headers=auth_headers)
    assert response.status_code == 200
    item = next(c for c in response.json()["items"] if c["id"] == card_id)
    assert item["categories"][0]["name"] == "科技"
    assert category_id in item["category_ids"]
```

若现有 fixture 名称不同，对齐 `test_prompt_card_routes.py` 已有写法（只改断言与写入方式，不发明新全局 fixture 体系）。

- [ ] **步骤 2：运行测试确认失败**

```bash
cd backend
python -m pytest tests/test_prompt_card_routes.py -k "categories" -v
```

预期：404 或字段缺失 FAIL。

- [ ] **步骤 3：实现后端**

在 `prompt_cards.py`：

```python
class CategoryItem(BaseModel):
    id: int
    name: str
    sort_order: int


class CategoryListResponse(BaseModel):
    items: list[CategoryItem]


class PromptCardItem(BaseModel):
    # ...existing fields...
    categories: list[CategoryItem]


@router.get("/categories", response_model=CategoryListResponse)
def list_categories(
    request: Request,
    _: str = Depends(require_token),
) -> CategoryListResponse:
    settings = request.app.state.settings
    connection = sqlite3.connect(settings.database_path)
    try:
        repository = PromptCardRepository(connection)
        items = [
            CategoryItem(id=c.id, name=c.name, sort_order=c.sort_order)
            for c in repository.list_categories()
        ]
        return CategoryListResponse(items=items)
    finally:
        connection.close()
```

在 `_to_prompt_card_item` 中根据 `card.category_ids` 查询名称填入 `categories`（可在同连接内批量读 `list_categories` 建 id→Category 映射，避免 N+1）。

- [ ] **步骤 4：更新前端 api.ts**

```ts
export type Category = {
  id: number;
  name: string;
  sort_order: number;
};

// PromptCard 增加 categories: Category[]

export async function getCategories(token: string): Promise<Category[]> {
  const response = await fetch("/api/categories", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await parseResponse<{ items: Category[] }>(response);
  return result.items;
}
```

更新所有 mock 卡片对象（`App.test.tsx`、`PromptCardBrowser.test.tsx`）补上 `categories: []`。

- [ ] **步骤 5：跑测试**

```bash
cd backend
python -m pytest tests/test_prompt_card_routes.py -v
cd ../frontend
npm test
```

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add backend/app/routes/prompt_cards.py backend/tests/test_prompt_card_routes.py frontend/src/api.ts frontend/src/App.test.tsx frontend/src/components/PromptCardBrowser.test.tsx
git commit -m "feat(api): 卡片列表返回分类信息并新增 categories 接口"
```

---

### 任务 3：收藏工具（localStorage）

**文件：**

- 新建：`frontend/src/lib/favorites.ts`
- 新建：`frontend/src/lib/favorites.test.ts`

- [ ] **步骤 1：写失败测试**

```ts
import { beforeEach, expect, test, vi } from "vitest";
import {
  FAVORITES_STORAGE_KEY,
  loadFavoriteIds,
  toggleFavoriteId,
  isFavoriteId,
} from "./favorites";

beforeEach(() => {
  localStorage.clear();
});

test("默认无收藏", () => {
  expect(loadFavoriteIds()).toEqual([]);
});

test("切换收藏会写入 localStorage", () => {
  const next = toggleFavoriteId(3);
  expect(next).toEqual([3]);
  expect(JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY)!)).toEqual([3]);
  expect(isFavoriteId(3, next)).toBe(true);
  const removed = toggleFavoriteId(3);
  expect(removed).toEqual([]);
});

test("损坏的 JSON 时回退为空数组", () => {
  localStorage.setItem(FAVORITES_STORAGE_KEY, "{not-json");
  expect(loadFavoriteIds()).toEqual([]);
});
```

- [ ] **步骤 2：运行确认失败**

```bash
cd frontend
npm test -- src/lib/favorites.test.ts
```

- [ ] **步骤 3：实现**

```ts
export const FAVORITES_STORAGE_KEY = "ipw.favorites";

export function loadFavoriteIds(): number[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === "number" && Number.isInteger(x));
  } catch {
    return [];
  }
}

export function saveFavoriteIds(ids: number[]): void {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
}

export function isFavoriteId(id: number, ids: number[] = loadFavoriteIds()): boolean {
  return ids.includes(id);
}

export function toggleFavoriteId(id: number): number[] {
  const current = loadFavoriteIds();
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  saveFavoriteIds(next);
  return next;
}
```

- [ ] **步骤 4：跑测试并通过后提交**

```bash
cd frontend
npm test -- src/lib/favorites.test.ts
git add frontend/src/lib/favorites.ts frontend/src/lib/favorites.test.ts
git commit -m "feat(frontend): 用 localStorage 实现个人收藏列表"
```

---

### 任务 4：AppShell 顶栏与视图切换骨架

**文件：**

- 新建：`frontend/src/components/AppShell.tsx`
- 新建：`frontend/src/components/WorkspacePlaceholder.tsx`
- 修改：`frontend/src/components/WelcomeView.tsx`（改为薄包装调用 `AppShell`，或删除并由 `App.tsx` 直接使用 `AppShell`）
- 修改：`frontend/src/App.tsx`
- 修改：`frontend/src/App.test.tsx`

- [ ] **步骤 1：写失败测试（扩展 App 集成）**

在 `App.test.tsx` 登录成功后断言：

```ts
expect(await screen.findByRole("navigation")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "提示词库" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "生成工作台" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "历史" })).toBeInTheDocument();
// 欢迎语不再作为主标题要求；若仍请求 /api/welcome 可保留但不展示大段欢迎文案
```

点击「生成工作台」应看到占位文案，例如「生成工作台即将推出」；点击「提示词库」返回。

- [ ] **步骤 2：运行确认失败**

```bash
cd frontend
npm test -- src/App.test.tsx
```

- [ ] **步骤 3：实现 AppShell**

```tsx
// AppShell.tsx 核心职责
// - props: token: string
// - state: view: AppView，默认 library
// - state: libraryFilters（提升，供返回时保留）
// - header:
//   左：logo + 「提示词库」「生成工作台」
//   右：「历史」+ LogoutButton（设置入口本期用退出代替完整设置页）
// - main:
//   view.library -> <PromptLibraryPage ... />  （任务 5 再填满，本任务可先放 PromptCardBrowser 过渡）
//   view.workspace -> <WorkspacePlaceholder cardId={...} onBack={() => setView({name:'library'})} />
//   history/settings -> 简单占位段落
```

`WorkspacePlaceholder`：

```tsx
export function WorkspacePlaceholder({
  cardId,
  onBack,
}: {
  cardId: number | null;
  onBack: () => void;
}) {
  return (
    <section className="workspace-placeholder">
      <button type="button" className="btn btn-secondary" onClick={onBack}>
        返回提示词库
      </button>
      <h1>生成工作台</h1>
      <p>生成工作台即将推出。本页仅作为「使用此提示词」跳转占位。</p>
      {cardId != null && <p>已选择提示词卡片 ID：{cardId}</p>}
    </section>
  );
}
```

登录后**不要**再以欢迎语作为页面主体；可停止调用 `getWelcome`，或静默调用仅用于 401 探测。推荐：直接依赖卡片列表 401 清理 token，删除对 welcome 的 UI 依赖（若删除 welcome 调用，同步改 `App.test.tsx` mock 与「欢迎信息」断言）。

本任务选定策略：**登录后不再请求/展示 welcome 文案**，鉴权失败由卡片列表 401 处理。更新所有依赖 welcome 文案的测试。

- [ ] **步骤 4：跑测试**

```bash
cd frontend
npm test -- src/App.test.tsx
```

- [ ] **步骤 5：提交**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/components/WorkspacePlaceholder.tsx frontend/src/components/WelcomeView.tsx frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(ui): 增加工作台壳层顶栏与页面视图切换"
```

---

### 任务 5：提示词库页 — 工具条与前端筛选

**文件：**

- 新建：`frontend/src/components/PromptLibraryPage.tsx`
- 新建：`frontend/src/components/PromptLibraryPage.test.tsx`
- 修改：`frontend/src/components/AppShell.tsx`（挂载库页）
- 修改：`frontend/src/index.css`

- [ ] **步骤 1：写失败测试**

```tsx
// PromptLibraryPage.test.tsx
const cardA = {
  id: 1,
  title: "江南烟雨",
  prompt_text: "水墨山水长卷",
  sort_order: 2,
  category_ids: [1],
  categories: [{ id: 1, name: "风景", sort_order: 0 }],
  image_count: 1,
  example_image_path: "prompt-images/0001-01.jpg",
  images: [{ index: 1, path: "prompt-images/0001-01.jpg", url: "/media/prompt-images/0001-01.jpg" }],
};
const cardB = {
  id: 2,
  title: "赛博城市",
  prompt_text: "霓虹夜景",
  sort_order: 1,
  category_ids: [2],
  categories: [{ id: 2, name: "科技", sort_order: 1 }],
  image_count: 1,
  example_image_path: "prompt-images/0002-01.png",
  images: [{ index: 1, path: "prompt-images/0002-01.png", url: "/media/prompt-images/0002-01.png" }],
};

// mock fetch: /api/prompt-cards -> [cardA, cardB], /api/categories -> 两个分类

test("按关键词过滤标题与提示词", async () => {
  // render PromptLibraryPage with token + onUsePrompt mock
  // 输入「赛博」后只剩赛博城市
});

test("按分类芯片过滤", async () => {
  // 点击「风景」只剩江南烟雨；点击「全部」恢复
});

test("点击使用此提示词会回调 card id", async () => {
  // getByRole('button', { name: '使用此提示词' }) 对第一张卡
});
```

- [ ] **步骤 2：运行确认失败**

```bash
cd frontend
npm test -- src/components/PromptLibraryPage.test.tsx
```

- [ ] **步骤 3：实现 PromptLibraryPage**

布局：

```text
[ 搜索框 ........................ ] [ 排序: 最新 ▾ ]
[ 全部 ][ 风景 ][ 科技 ] ...                    [ ☆ 收藏 ]
[ 卡片网格 ... ]
```

筛选逻辑（纯函数，可写在同文件顶部便于测）：

```ts
export function filterPromptCards(
  cards: PromptCard[],
  filters: LibraryFilters,
  favoriteIds: number[],
): PromptCard[] {
  let result = cards;
  const q = filters.query.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.prompt_text.toLowerCase().includes(q),
    );
  }
  if (filters.categoryId != null) {
    result = result.filter((c) => c.category_ids.includes(filters.categoryId!));
  }
  if (filters.favoritesOnly) {
    result = result.filter((c) => favoriteIds.includes(c.id));
  }
  const sorted = [...result];
  if (filters.sort === "title") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, "zh"));
  } else if (filters.sort === "oldest") {
    sorted.sort((a, b) => a.id - b.id);
  } else {
    // newest：id 降序（当前无 created_at 暴露时的近似）
    sorted.sort((a, b) => b.id - a.id);
  }
  return sorted;
}
```

数据加载：

- `getPromptCards(token)`
- `getCategories(token)`
- 401 → `clearToken(token)`

空态文案：

- 加载中：`正在加载提示词…`
- 加载失败：`提示词卡片加载失败`
- 无卡片：`暂无提示词卡片`
- 筛选无结果：`没有符合条件的提示词`

- [ ] **步骤 4：跑测试**

```bash
cd frontend
npm test -- src/components/PromptLibraryPage.test.tsx
```

- [ ] **步骤 5：提交**

```bash
git add frontend/src/components/PromptLibraryPage.tsx frontend/src/components/PromptLibraryPage.test.tsx frontend/src/components/AppShell.tsx frontend/src/index.css
git commit -m "feat(ui): 实现提示词库搜索分类排序与收藏筛选"
```

---

### 任务 6：提示词卡片 UI — 4:3、标签、主按钮

**文件：**

- 修改：`frontend/src/components/PromptCardCard.tsx`
- 修改：`frontend/src/components/PromptCardBrowser.tsx`（若库页直接 map 卡片，可废弃 Browser 网格职责，仅保留复用逻辑或删除引用）
- 修改：`frontend/src/components/PromptCardDialog.tsx`（去掉 YouMind 链接；可选「预览」仍保留）
- 修改：`frontend/src/index.css`
- 修改：相关测试

- [ ] **步骤 1：更新/新增失败测试**

`PromptCardBrowser.test.tsx` 或库页测试中断言：

```ts
// 封面容器有 4:3 比例类名
expect(document.querySelector(".prompt-card-image-frame")).toHaveClass(
  "prompt-card-image-frame--4x3",
);
// 主 CTA
expect(screen.getAllByRole("button", { name: "使用此提示词" }).length).toBeGreaterThan(0);
// 不再出现外链
expect(screen.queryByRole("link", { name: "立即生成" })).not.toBeInTheDocument();
```

- [ ] **步骤 2：运行确认相关断言失败后实现卡片**

`PromptCardCard` props：

```ts
type PromptCardCardProps = {
  card: PromptCard;
  imageUrl: string | null;
  imageFailed: boolean;
  onImageError: () => void;
  favorited: boolean;
  onToggleFavorite: () => void;
  onUsePrompt: () => void;
  onPreview?: () => void; // 可选：点封面打开只读预览弹窗
};
```

结构：

```tsx
<article className="prompt-card">
  <div className="prompt-card-image-frame prompt-card-image-frame--4x3" onClick={onPreview}>
    {/* img contain 或 暂无图片 */}
    {card.image_count > 1 && <span className="prompt-card-count">共 {card.image_count} 张</span>}
  </div>
  <div className="prompt-card-body">
    <div className="prompt-card-title-row">
      <h2 className="prompt-card-title">{card.title}</h2>
      <button type="button" aria-label={favorited ? "取消收藏" : "收藏"} onClick={onToggleFavorite}>
        {favorited ? "★" : "☆"}
      </button>
    </div>
    <ul className="prompt-card-tags">
      {card.categories.map((c) => (
        <li key={c.id}>{c.name}</li>
      ))}
    </ul>
    <p className="prompt-card-summary">{summary}</p>
    <button type="button" className="btn btn-primary" onClick={onUsePrompt}>
      使用此提示词
    </button>
  </div>
</article>
```

CSS：

```css
.prompt-card-image-frame--4x3 {
  aspect-ratio: 4 / 3;
  height: auto; /* 覆盖旧固定 height: 12rem */
  background: #f3f4f6;
}
.prompt-card-image {
  object-fit: contain;
}
.prompt-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
.prompt-card-tags li {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
```

`PromptCardDialog`：删除 YouMind `<a className="prompt-card-try-link">`；可加按钮「使用此提示词」调用传入的 `onUsePrompt`。

- [ ] **步骤 3：库页接入 onUsePrompt → AppShell setView({ name: "workspace", cardId })**

返回库页时恢复 filters；可选恢复 `sessionStorage` 滚动。

- [ ] **步骤 4：全量前端测试**

```bash
cd frontend
npm test
```

- [ ] **步骤 5：提交**

```bash
git add frontend/src/components/PromptCardCard.tsx frontend/src/components/PromptCardDialog.tsx frontend/src/components/PromptCardBrowser.tsx frontend/src/components/PromptLibraryPage.tsx frontend/src/components/AppShell.tsx frontend/src/index.css frontend/src/components/*.test.tsx
git commit -m "feat(ui): 提示词卡片改为 4:3 网格与使用此提示词入口"
```

---

### 任务 7：视觉打磨、无障碍与回归验收

**文件：**

- 修改：`frontend/src/index.css`
- 按需微调组件 class
- 修改测试仅当文案/角色变化时

- [ ] **步骤 1：对照设计稿检查清单（人工 + 测试能覆盖的部分自动化）**

登录页：

- [ ] 居中白卡片、浅灰边框、黑主按钮
- [ ] 标题 / 副标题 / 仅密码 / 无注册社交
- [ ] 错误为内联 `role="alert"`

提示词库：

- [ ] 顶栏：提示词库为当前态（下划线或字重）
- [ ] 搜索框占位符类似「搜索提示词关键词…」
- [ ] 排序下拉：最新 / 最旧 / 标题
- [ ] 分类芯片 + 收藏
- [ ] 卡片 4:3 contain，黑按钮「使用此提示词」
- [ ] 无作者/点赞/评论/分享
- [ ] 无编辑器、参考图、参数、结果、历史列表

- [ ] **步骤 2：补充可自动化的验收测试**

在 `PromptLibraryPage.test.tsx`：

```ts
test("首页不渲染生成参数或参考图区域", async () => {
  // render library
  expect(screen.queryByText("生成参考图")).not.toBeInTheDocument();
  expect(screen.queryByText("开始生成")).not.toBeInTheDocument();
  expect(screen.queryByText("生成参数")).not.toBeInTheDocument();
});
```

- [ ] **步骤 3：构建与全量测试**

```bash
cd frontend
npm test
npm run build
cd ../backend
python -m pytest -q
```

预期：全部通过；`npm run build` 无 TS 错误。

- [ ] **步骤 4：提交**

```bash
git add frontend backend
git commit -m "style(ui): 对齐提示词库与登录页浅色工作台视觉规范"
```

---

## 验收标准（对照设计 §11.1 / §12 / §7）

| 条目 | 验收方式 |
| --- | --- |
| 登录页仅密码 + 黑按钮 + 产品名副标题 | LoginForm 测试 + 目视 |
| 登录失败内联错误 | LoginForm 测试 |
| 首页为提示词库卡片网格 | 集成测试 |
| 4:3 封面 contain | CSS + 类名断言 |
| 搜索 / 分类 / 排序 / 收藏 | PromptLibraryPage 测试 |
| 「使用此提示词」进入占位工作台并带 cardId | 集成测试 |
| 返回库保留筛选 | 手动或状态提升单测 |
| 无社交信息、无生成编辑区 | 否定断言测试 |
| 删除 YouMind 外链 | 测试 queryByRole link |
| 分类 API 可用 | 后端 pytest |

---

## 实现顺序建议

1. 任务 1 登录页（独立可见）
2. 任务 2 分类 API（解锁标签数据）
3. 任务 3 收藏工具
4. 任务 4 壳层导航
5. 任务 5 库页筛选
6. 任务 6 卡片 CTA
7. 任务 7 视觉与全量回归

---

## 计划自检

### 1. Spec 覆盖

| 设计要求 | 对应任务 |
| --- | --- |
| §12 登录页 | 任务 1 |
| §7 视觉规范 | 任务 1、6、7 |
| §11.1 提示词库独立页、卡片信息、使用此提示词 | 任务 4–6 |
| §11.1 搜索筛选滚动保留 | 任务 4–5 filters 提升 |
| §2 首页不出现编辑器/参考图/结果/历史 | 任务 5–7 否定断言 |
| §10 不注册/不社交 | 任务 1、7 |
| 分类标签展示 | 任务 2、6 |
| 生成工作台/历史仅导航占位 | 任务 4 |

### 2. 占位符扫描

计划中工作台/历史明确为**占位页**（有组件与文案），不是 “TBD 以后再写步骤”。完整生成页不在范围。

### 3. 类型一致性

- `AppView` / `LibraryFilters` / `Category` / `PromptCard.categories` 在任务 2–5 统一使用。
- `onUsePrompt` 传递 `cardId: number`。
- 收藏 id 类型为 `number[]`。

---

## 分支

实现分支：`feat/ui-redesign-home-login`（由计划编写阶段创建）。

基于：`main`。
