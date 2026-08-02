import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import {
  defaultLibraryFilters,
  filterPromptCards,
  PromptLibraryPage,
  type LibraryFilters,
} from "./PromptLibraryPage";

const cardA = {
  id: 1,
  title: "江南烟雨",
  prompt_text: "水墨山水长卷",
  sort_order: 2,
  category_ids: [1],
  categories: [{ id: 1, name: "风景", sort_order: 0 }],
  image_count: 1,
  example_image_path: "prompt-images/0001-01.jpg",
  images: [
    {
      index: 1,
      path: "prompt-images/0001-01.jpg",
      url: "/media/prompt-images/0001-01.jpg",
    },
  ],
};

const cardB = {
  id: 2,
  title: "赛博城市",
  prompt_text: "霓虹夜景",
  sort_order: 1,
  category_ids: [2],
  categories: [{ id: 2, name: "科技", sort_order: 1 }],
  image_count: 2,
  example_image_path: "prompt-images/0002-01.png",
  images: [
    {
      index: 1,
      path: "prompt-images/0002-01.png",
      url: "/media/prompt-images/0002-01.png",
    },
    {
      index: 2,
      path: "prompt-images/0002-02.png",
      url: "/media/prompt-images/0002-02.png",
    },
  ],
};

function renderLibrary(
  onUsePrompt = vi.fn(),
  filters: LibraryFilters = defaultLibraryFilters,
  onFiltersChange = vi.fn(),
) {
  return render(
    <AuthProvider>
      <PromptLibraryPage
        token="token-1"
        filters={filters}
        onFiltersChange={onFiltersChange}
        onUsePrompt={onUsePrompt}
      />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/prompt-cards")) {
      return new Response(JSON.stringify({ items: [cardA, cardB] }), {
        status: 200,
      });
    }
    if (url.includes("/api/categories")) {
      return new Response(
        JSON.stringify({
          items: [
            { id: 1, name: "风景", sort_order: 0 },
            { id: 2, name: "科技", sort_order: 1 },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
});

test("显示首图和图片数量", async () => {
  renderLibrary();
  expect(await screen.findByText("共 2 张")).toBeInTheDocument();
  expect(screen.getByText("赛博城市")).toBeInTheDocument();
  const frames = document.querySelectorAll(".prompt-card-image-frame--4x3");
  expect(frames.length).toBeGreaterThan(0);
});

test("按关键词过滤标题与提示词", async () => {
  const user = userEvent.setup();
  function ControlledLibrary() {
    const [filters, setFilters] = useState(defaultLibraryFilters);
    return (
      <AuthProvider>
        <PromptLibraryPage
          token="token-1"
          filters={filters}
          onFiltersChange={setFilters}
          onUsePrompt={vi.fn()}
        />
      </AuthProvider>
    );
  }
  render(<ControlledLibrary />);

  expect(await screen.findByText("江南烟雨")).toBeInTheDocument();
  await user.type(screen.getByLabelText("搜索提示词"), "赛博");
  expect(screen.queryByText("江南烟雨")).not.toBeInTheDocument();
  expect(screen.getByText("赛博城市")).toBeInTheDocument();
});

test("filterPromptCards 按关键词与分类过滤", () => {
  const byQuery = filterPromptCards([cardA, cardB], {
    ...defaultLibraryFilters,
    query: "赛博",
  });
  expect(byQuery.map((card) => card.title)).toEqual(["赛博城市"]);

  const byCategory = filterPromptCards([cardA, cardB], {
    ...defaultLibraryFilters,
    categoryId: 1,
  });
  expect(byCategory.map((card) => card.title)).toEqual(["江南烟雨"]);
});

test("按分类芯片过滤", async () => {
  const user = userEvent.setup();
  const onFiltersChange = vi.fn();
  renderLibrary(vi.fn(), defaultLibraryFilters, onFiltersChange);

  expect(await screen.findByRole("button", { name: "风景" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "风景" }));
  expect(onFiltersChange).toHaveBeenCalledWith(
    expect.objectContaining({ categoryId: 1 }),
  );
});

test("点击使用此提示词会回调 card id", async () => {
  const user = userEvent.setup();
  const onUsePrompt = vi.fn();
  renderLibrary(onUsePrompt);

  const buttons = await screen.findAllByRole("button", { name: "使用此提示词" });
  await user.click(buttons[0]);
  expect(onUsePrompt).toHaveBeenCalled();
});

test("点击封面可打开预览轮播", async () => {
  const user = userEvent.setup();
  renderLibrary();

  await user.click(await screen.findByRole("button", { name: "预览 赛博城市" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toBeInTheDocument();
  expect(dialog).toHaveTextContent("霓虹夜景");
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
});

test("首页不渲染生成参数或参考图区域", async () => {
  renderLibrary();
  expect(await screen.findByText("江南烟雨")).toBeInTheDocument();
  expect(screen.queryByText("生成参考图")).not.toBeInTheDocument();
  expect(screen.queryByText("开始生成")).not.toBeInTheDocument();
  expect(screen.queryByText("生成参数")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "立即生成" })).not.toBeInTheDocument();
});

test("分类筛选后的可见结果", async () => {
  render(
    <AuthProvider>
      <PromptLibraryPage
        token="token-1"
        filters={{ ...defaultLibraryFilters, categoryId: 1 }}
        onFiltersChange={vi.fn()}
        onUsePrompt={vi.fn()}
      />
    </AuthProvider>,
  );

  expect(await screen.findByText("江南烟雨")).toBeInTheDocument();
  expect(screen.queryByText("赛博城市")).not.toBeInTheDocument();
});
