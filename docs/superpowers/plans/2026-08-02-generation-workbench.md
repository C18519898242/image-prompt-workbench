# 生成工作台实现计划

> 对执行代理：必须使用 subagent-driven-development 或 executing-plans 逐任务执行本计划。每一步使用复选框跟踪。

**目标：** 将当前生成工作台占位内容替换为一个只负责准备单次图片生成任务的可交互前端页面。

**架构：** 复用已有提示词卡片数据。用户从现有提示词选择入口进入工作台时，把已加载的 PromptCard 传给新的 GenerationWorkspacePage，页面只在本地维护提示词草稿、示例图位置、参考图预览、参数和提交反馈。点击“开始生成”不调用后端，只显示就地反馈并留在当前页。

**技术栈：** React、TypeScript、原生 CSS、Vitest、React Testing Library、user-event。

## 全局约束

- 只修改生成工作台相关代码和必要的进入接线，不实现其他页面或功能。
- 不新增后端接口，不上传参考图，不保存任务，不展示生成结果或历史记录。
- 参考图使用浏览器本地 URL.createObjectURL 预览，删除或离开页面时释放对象 URL。
- 提示词示例图使用 contain，固定 4:3 展示区，不裁剪、不拉伸。
- 页面只保留一个“开始生成”按钮。
- 不添加清空按钮、字符数统计、自定义键盘快捷键、拖拽上传、裁剪、上传进度或未确认的高级参数字段。
- 使用现有依赖，不安装新组件库或图标库。
- 代码注释和用户可见文案使用中文；本计划和相关设计文档使用中文。

## 文件变更地图

- 修改：frontend/src/components/AppShell.tsx，让工作台视图携带完整的 PromptCard。
- 修改：frontend/src/components/PromptLibraryPage.tsx，让“使用此提示词”回调传出当前卡片。
- 删除：frontend/src/components/WorkspacePlaceholder.tsx，移除占位页面。
- 新建：frontend/src/components/GenerationWorkspacePage.tsx，承载工作台布局和全部本地交互状态。
- 新建：frontend/src/components/GenerationWorkspacePage.test.tsx，覆盖工作台交互。
- 修改：frontend/src/App.test.tsx，把进入占位页的测试改为进入真实工作台的集成测试。
- 修改：frontend/src/index.css，添加工作台布局样式并删除占位样式。
- 不修改：frontend/src/api.ts 和后端代码。

---

### 任务 1：把已选提示词传入工作台

**文件：**

- 修改：frontend/src/components/PromptLibraryPage.tsx
- 修改：frontend/src/components/AppShell.tsx
- 删除：frontend/src/components/WorkspacePlaceholder.tsx
- 新建：frontend/src/components/GenerationWorkspacePage.tsx，先提供进入后的最小工作台壳。
- 修改：frontend/src/App.test.tsx

**接口：**

- PromptLibraryPage 产出：onUsePrompt(card: PromptCard) => void
- AppShell 内部视图：{ name: "workspace"; card: PromptCard }
- GenerationWorkspacePage 消费：{ card: PromptCard; onBack: () => void }

- [ ] **步骤 1：先改集成测试，让它验证真实工作台入口**

在 frontend/src/App.test.tsx 中，把原来的占位断言替换为以下行为断言：

~~~tsx
await user.click(screen.getByRole("button", { name: "使用此提示词" }));

expect(screen.getByRole("heading", { name: "生成工作台" })).toBeInTheDocument();
expect(screen.getByText("测试卡片")).toBeInTheDocument();
expect(screen.getByDisplayValue("测试提示词")).toBeInTheDocument();

await user.click(screen.getByRole("button", { name: "返回提示词库" }));
expect(await screen.findByText("测试卡片")).toBeInTheDocument();
~~~

保留当前测试中的 card fixture 和现有测试准备代码，不增加其他页面断言。

- [ ] **步骤 2：运行集成测试，确认它先失败**

运行：

~~~powershell
cd frontend
npm test -- src/App.test.tsx
~~~

预期：失败，因为当前仍然渲染 WorkspacePlaceholder，没有可编辑的提示词文本框。

- [ ] **步骤 3：修改提示词卡片回调和 AppShell 视图数据**

在 PromptLibraryPage.tsx 中将属性类型和卡片回调改为：

~~~tsx
type PromptLibraryPageProps = {
  token: string;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  onUsePrompt: (card: PromptCard) => void;
};

<PromptCardCard
  key={card.id}
  card={card}
  imageUrl={first?.url ?? null}
  imageFailed={Boolean(failedImages[key])}
  onImageError={() => markFailed(key)}
  onUsePrompt={() => onUsePrompt(card)}
  onPreview={() => {
    setSelectedCardId(card.id);
    setCurrentIndex(1);
  }}
/>
~~~

在 AppShell.tsx 中使用：

~~~tsx
import type { PromptCard } from "../api";
import { GenerationWorkspacePage } from "./GenerationWorkspacePage";

export type AppView =
  | { name: "library" }
  | { name: "workspace"; card: PromptCard };
~~~

将进入和渲染分支改为：

~~~tsx
onUsePrompt={(card) => setView({ name: "workspace", card })}
~~~

~~~tsx
{view.name === "workspace" && (
  <GenerationWorkspacePage
    card={view.card}
    onBack={() => setView({ name: "library" })}
  />
)}
~~~

删除 WorkspacePlaceholder.tsx，不保留占位组件。

在同一任务中新增最小的 GenerationWorkspacePage 壳，保证入口接线可以独立编译和测试：

~~~tsx
import type { PromptCard } from "../api";

export type GenerationWorkspacePageProps = {
  card: PromptCard;
  onBack: () => void;
};

export function GenerationWorkspacePage({
  card,
  onBack,
}: GenerationWorkspacePageProps) {
  return (
    <section className="generation-workspace">
      <button type="button" onClick={onBack}>
        返回提示词库
      </button>
      <h1>生成工作台</h1>
      <p>{card.title}</p>
      <textarea
        className="generation-prompt-editor"
        aria-label="提示词"
        value={card.prompt_text}
        readOnly
      />
    </section>
  );
}
~~~

- [ ] **步骤 4：运行集成测试，确认入口接线通过**

运行：

~~~powershell
cd frontend
npm test -- src/App.test.tsx
~~~

预期：入口集成测试通过，工作台已经显示标题、当前卡片标题、提示词文本框，并可以返回。

- [ ] **步骤 5：提交入口接线**

~~~powershell
git add frontend/src/components/AppShell.tsx frontend/src/components/PromptLibraryPage.tsx frontend/src/App.test.tsx frontend/src/components/WorkspacePlaceholder.tsx
git commit -m "feat: 传递提示词卡片到生成工作台"
~~~

### 任务 2：实现生成工作台的本地交互

**文件：**

- 修改：frontend/src/components/GenerationWorkspacePage.tsx
- 新建：frontend/src/components/GenerationWorkspacePage.test.tsx

**接口：**

~~~tsx
export type GenerationWorkspacePageProps = {
  card: PromptCard;
  onBack: () => void;
};

type ReferenceImage = {
  id: string;
  name: string;
  url: string;
};

type GenerationParams = {
  model: "Nano Banana 2";
  aspectRatio: "1:1" | "4:3" | "16:9";
  resolution: "1K" | "2K";
  count: "1" | "2" | "4";
  thinking: "低" | "中等" | "高";
};

const parameterOptions = {
  model: ["Nano Banana 2"],
  aspectRatio: ["1:1", "4:3", "16:9"],
  resolution: ["1K", "2K"],
  count: ["1", "2", "4"],
  thinking: ["低", "中等", "高"],
} as const;
~~~

- [ ] **步骤 1：先写工作台行为测试**

在 GenerationWorkspacePage.test.tsx 中准备一个包含两张示例图的 PromptCard fixture，并覆盖：

~~~tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import type { PromptCard } from "../api";
import { GenerationWorkspacePage } from "./GenerationWorkspacePage";

const workbenchCard: PromptCard = {
  id: 1,
  title: "江南烟雨",
  prompt_text: "水墨山水长卷",
  sort_order: 1,
  category_ids: [],
  categories: [],
  image_count: 2,
  example_image_path: "prompt-images/0001-01.jpg",
  images: [
    {
      index: 1,
      path: "prompt-images/0001-01.jpg",
      url: "/media/prompt-images/0001-01.jpg",
    },
    {
      index: 2,
      path: "prompt-images/0001-02.jpg",
      url: "/media/prompt-images/0001-02.jpg",
    },
  ],
};

function renderWorkspace() {
  return render(
    <GenerationWorkspacePage card={workbenchCard} onBack={vi.fn()} />,
  );
}

test("显示提示词、示例图、参考图区和参数区", () => {
  renderWorkspace();

  expect(screen.getByRole("heading", { name: "生成工作台" })).toBeInTheDocument();
  expect(screen.getByText("江南烟雨")).toBeInTheDocument();
  expect(screen.getByDisplayValue("水墨山水长卷")).toBeInTheDocument();
  expect(screen.getByText("提示词示例图")).toBeInTheDocument();
  expect(screen.getByText("生成参考图（可选）")).toBeInTheDocument();
  expect(screen.getByText("生成参数")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开始生成" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "清空" })).not.toBeInTheDocument();
  expect(screen.queryByText(/字符数/)).not.toBeInTheDocument();
});

test("可以切换提示词示例图", async () => {
  const user = userEvent.setup();
  renderWorkspace();

  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一张提示词示例图" }));

  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "江南烟雨示例图 2" })).toHaveAttribute(
    "src",
    "/media/prompt-images/0001-02.jpg",
  );
});

test("可以添加和删除本地生成参考图", async () => {
  const user = userEvent.setup();
  renderWorkspace();
  const file = new File(["image"], "reference.png", { type: "image/png" });

  await user.upload(screen.getByLabelText("选择生成参考图"), file);
  expect(screen.getByRole("img", { name: "生成参考图 1" })).toHaveAttribute(
    "src",
    "blob:reference",
  );

  await user.click(screen.getByRole("button", { name: "删除生成参考图 1" }));
  expect(screen.queryByRole("img", { name: "生成参考图 1" })).not.toBeInTheDocument();
});

test("提示词为空时禁用提交，提交后显示本地反馈", async () => {
  const user = userEvent.setup();
  renderWorkspace();
  const prompt = screen.getByRole("textbox", { name: "提示词" });
  const submit = screen.getByRole("button", { name: "开始生成" });

  await user.clear(prompt);
  expect(submit).toBeDisabled();

  await user.type(prompt, "新的图片提示词");
  expect(submit).toBeEnabled();
  await user.click(submit);

  expect(screen.getByText("已创建本地生成任务（演示）")).toBeInTheDocument();
  expect(screen.getByDisplayValue("新的图片提示词")).toBeInTheDocument();
});

test("高级参数入口可以展开和收起但不添加未确认字段", async () => {
  const user = userEvent.setup();
  renderWorkspace();
  const advanced = screen.getByRole("button", { name: "高级参数" });

  expect(advanced).toHaveAttribute("aria-expanded", "false");
  await user.click(advanced);
  expect(advanced).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByLabelText("随机种子")).not.toBeInTheDocument();
});
~~~

测试文件的 beforeEach 只为本地预览提供对象 URL：

~~~tsx
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:reference");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
~~~

- [ ] **步骤 2：运行工作台测试，确认它先失败**

运行：

~~~powershell
cd frontend
npm test -- src/components/GenerationWorkspacePage.test.tsx
~~~

预期：失败，因为最小工作台壳还没有示例图导航、参考图网格、参数控件和提交反馈。

- [ ] **步骤 3：实现工作台状态和事件处理**

在 GenerationWorkspacePage.tsx 中使用以下最小状态：

~~~tsx
const [exampleIndex, setExampleIndex] = useState(0);
const [promptDraft, setPromptDraft] = useState(card.prompt_text);
const [references, setReferences] = useState<ReferenceImage[]>([]);
const [params, setParams] = useState<GenerationParams>({
  model: "Nano Banana 2",
  aspectRatio: "4:3",
  resolution: "1K",
  count: "1",
  thinking: "中等",
});
const [advancedOpen, setAdvancedOpen] = useState(false);
const [submitMessage, setSubmitMessage] = useState<string | null>(null);
const referenceUrls = useRef(new Set<string>());
const referenceId = useRef(0);
~~~

本地文件处理使用：

~~~tsx
function handleReferenceFiles(files: FileList | null) {
  if (!files) return;

  const next = Array.from(files).map((file) => {
    const url = URL.createObjectURL(file);
    referenceUrls.current.add(url);
    return {
      id: file.name + "-" + file.lastModified + "-" + referenceId.current++,
      name: file.name,
      url,
    };
  });

  setReferences((current) => [...current, ...next]);
}

function removeReference(id: string) {
  setReferences((current) => {
    const removed = current.find((reference) => reference.id === id);
    if (removed) {
      URL.revokeObjectURL(removed.url);
      referenceUrls.current.delete(removed.url);
    }
    return current.filter((reference) => reference.id !== id);
  });
}
~~~

组件卸载时释放剩余对象 URL：

~~~tsx
useEffect(() => {
  return () => {
    referenceUrls.current.forEach((url) => URL.revokeObjectURL(url));
    referenceUrls.current.clear();
  };
}, []);
~~~

提交处理只保留本地反馈：

~~~tsx
function handleSubmit() {
  if (!promptDraft.trim()) return;
  setSubmitMessage("已创建本地生成任务（演示）");
}
~~~

- [ ] **步骤 4：实现工作台 JSX**

页面只渲染以下区域：

~~~tsx
<section className="generation-workspace">
  <div className="generation-workspace-header">
    <button type="button" className="btn btn-secondary" onClick={onBack}>
      返回提示词库
    </button>
    <h1>生成工作台</h1>
    <p>{card.title}</p>
  </div>

  <div className="generation-workspace-columns">
    <div className="generation-workspace-left">
      <section className="generation-panel">
        <h2>提示词示例图</h2>
        <div className="generation-example-stage">
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="上一张提示词示例图"
            disabled={exampleIndex === 0}
            onClick={() => setExampleIndex((index) => Math.max(0, index - 1))}
          >
            上一张
          </button>
          <div className="generation-example-image">
            {card.images[exampleIndex] ? (
              <img
                src={card.images[exampleIndex].url}
                alt={card.title + "示例图 " + (exampleIndex + 1)}
              />
            ) : (
              <span>暂无示例图</span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="下一张提示词示例图"
            disabled={exampleIndex >= card.images.length - 1}
            onClick={() =>
              setExampleIndex((index) =>
                Math.min(card.images.length - 1, index + 1),
              )
            }
          >
            下一张
          </button>
        </div>
        {card.images.length > 0 && (
          <p className="generation-example-counter">
            {exampleIndex + 1} / {card.images.length}
          </p>
        )}
        <p className="generation-example-note">仅用于理解效果</p>
      </section>
      <section className="generation-panel">
        <h2>提示词</h2>
        <textarea
          className="generation-prompt-editor"
          aria-label="提示词"
          value={promptDraft}
          onChange={(event) => {
            setPromptDraft(event.target.value);
            setSubmitMessage(null);
          }}
        />
      </section>
    </div>

    <aside className="generation-workspace-right">
      <section className="generation-panel">
        <h2>生成参考图（可选）</h2>
        <div className="generation-reference-grid">
          {references.map((reference, index) => (
            <div className="generation-reference-card" key={reference.id}>
              <img src={reference.url} alt={"生成参考图 " + (index + 1)} />
              <button
                type="button"
                className="generation-reference-remove"
                aria-label={"删除生成参考图 " + (index + 1)}
                onClick={() => removeReference(reference.id)}
              >
                删除
              </button>
            </div>
          ))}
          <label className="generation-reference-card generation-reference-add">
            <span>添加</span>
            <input
              type="file"
              accept="image/*"
              multiple
              aria-label="选择生成参考图"
              onChange={(event) => {
                handleReferenceFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </section>
      <section className="generation-panel">
        <h2>生成参数</h2>
        <div className="generation-parameter-grid">
          <label className="generation-parameter-field">
            <span>模型</span>
            <select
              aria-label="模型"
              value={params.model}
              onChange={(event) =>
                setParams((current) => ({
                  ...current,
                  model: event.target.value as GenerationParams["model"],
                }))
              }
            >
              {parameterOptions.model.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="generation-parameter-field">
            <span>比例</span>
            <select
              aria-label="比例"
              value={params.aspectRatio}
              onChange={(event) =>
                setParams((current) => ({
                  ...current,
                  aspectRatio: event.target.value as GenerationParams["aspectRatio"],
                }))
              }
            >
              {parameterOptions.aspectRatio.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="generation-parameter-field">
            <span>分辨率</span>
            <select
              aria-label="分辨率"
              value={params.resolution}
              onChange={(event) =>
                setParams((current) => ({
                  ...current,
                  resolution: event.target.value as GenerationParams["resolution"],
                }))
              }
            >
              {parameterOptions.resolution.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="generation-parameter-field">
            <span>生成数量</span>
            <select
              aria-label="生成数量"
              value={params.count}
              onChange={(event) =>
                setParams((current) => ({
                  ...current,
                  count: event.target.value as GenerationParams["count"],
                }))
              }
            >
              {parameterOptions.count.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="generation-parameter-field">
            <span>思考级别</span>
            <select
              aria-label="思考级别"
              value={params.thinking}
              onChange={(event) =>
                setParams((current) => ({
                  ...current,
                  thinking: event.target.value as GenerationParams["thinking"],
                }))
              }
            >
              {parameterOptions.thinking.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          高级参数
        </button>
        <button
          type="button"
          className="btn btn-primary generation-submit"
          disabled={!promptDraft.trim()}
          onClick={handleSubmit}
        >
          开始生成
        </button>
        {submitMessage && <p role="status">{submitMessage}</p>}
      </section>
    </aside>
  </div>
</section>
~~~

示例图没有数据时只渲染空状态；有数据时使用 card.images[exampleIndex]，并将上一张/下一张限制在 0 到 card.images.length - 1 范围内。所有图片必须使用 object-fit: contain。

- [ ] **步骤 5：运行工作台测试，确认行为通过**

运行：

~~~powershell
cd frontend
npm test -- src/components/GenerationWorkspacePage.test.tsx
~~~

预期：所有工作台行为测试通过。

- [ ] **步骤 6：提交工作台交互**

~~~powershell
git add frontend/src/components/GenerationWorkspacePage.tsx frontend/src/components/GenerationWorkspacePage.test.tsx
git commit -m "feat: 实现生成工作台交互"
~~~

### 任务 3：补齐工作台视觉样式并完成验证

**文件：**

- 修改：frontend/src/index.css

- [ ] **步骤 1：添加工作台布局样式并删除占位样式**

在 index.css 中删除 workspace-placeholder 相关规则，新增以下样式族：

~~~css
.generation-workspace {
  display: grid;
  gap: 1rem;
  padding: 1.25rem 1.5rem 2rem;
}

.generation-workspace-header {
  display: grid;
  gap: 0.45rem;
}

.generation-workspace-header h1,
.generation-workspace-header p,
.generation-panel h2 {
  margin: 0;
}

.generation-workspace-header p {
  color: var(--color-text-muted);
}

.generation-workspace-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(20rem, 0.85fr);
  gap: 1rem;
  align-items: start;
}

.generation-workspace-left,
.generation-workspace-right {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.generation-panel {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
  padding: 1.1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.generation-example-stage {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr) 4rem;
  align-items: center;
  gap: 0.5rem;
  aspect-ratio: 4 / 3;
  min-height: 20rem;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #f9fafb;
}

.generation-example-stage img,
.generation-reference-card img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.generation-example-image {
  display: grid;
  place-items: center;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.generation-reference-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.generation-reference-card {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #f3f4f6;
}

.generation-reference-add {
  display: grid;
  place-items: center;
  border: 1px dashed #9ca3af;
  color: var(--color-text-muted);
  background: #ffffff;
}

.generation-reference-add input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.generation-parameter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.generation-parameter-field {
  display: grid;
  gap: 0.35rem;
}

.generation-parameter-field select,
.generation-prompt-editor {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
}

.generation-prompt-editor {
  min-height: 18rem;
  resize: vertical;
  padding: 0.85rem;
  line-height: 1.6;
}

.generation-submit {
  width: 100%;
  min-height: 3.25rem;
}

@media (max-width: 960px) {
  .generation-workspace-columns {
    grid-template-columns: 1fr;
  }
}
~~~

补充删除按钮、示例图导航按钮、空状态和参数标签的最小样式，沿用现有 .btn、颜色、圆角和边框变量，不引入新的视觉系统。

- [ ] **步骤 2：运行所有前端测试和构建**

运行：

~~~powershell
cd frontend
npm test
npm run build
~~~

预期：所有测试通过，TypeScript 编译和 Vite 构建成功。

- [ ] **步骤 3：按设计稿做一次人工检查**

只检查生成工作台本身：

1. 左侧示例图区域固定为 4:3，竖向图保持完整显示。
2. 右侧参考图能添加、预览和删除，网格自然换行。
3. 参数区只有已确认的字段，高级参数没有自定义字段。
4. 页面只有一个“开始生成”按钮，提交后没有结果图或其他页面。
5. 页面没有清空按钮、字符数统计、假进度或全局弹窗。

- [ ] **步骤 4：提交样式和最终验证**

~~~powershell
git add frontend/src/index.css
git commit -m "style: 完成生成工作台布局"
~~~

## 计划自审

- 设计稿中的示例图浏览、提示词编辑、参考图本地添加/删除、参数区和唯一提交按钮均有对应任务。
- 本地提交反馈有明确测试，不会实现真实生图、结果、历史或持久化。
- 没有任务涉及其他页面功能或其他产品内容。
- 计划中未加入清空按钮、字符数、快捷键、拖拽上传、裁剪、上传进度或未确认高级参数字段。
- PromptCard、GenerationWorkspacePageProps、ReferenceImage 和 GenerationParams 的名称在任务之间保持一致。
- 所有代码步骤都给出目标文件、接口、测试命令和预期结果。
