import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/prompt-cards") && method === "GET") {
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

function mockDeleteResponse(status: number, detail?: string) {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/prompt-cards/2" && method === "DELETE") {
      return status === 204
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ detail }), { status });
    }
    if (url.includes("/api/prompt-cards") && method === "GET") {
      return new Response(JSON.stringify({ items: [cardA, cardB] }), {
        status: 200,
      });
    }
    if (url.includes("/api/categories") && method === "GET") {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  return fetchMock;
}

async function openCyberDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "赛博城市的更多操作" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "删除" }));
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("从工具栏新增卡片并增量更新列表", async () => {
  const cardC = {
    ...cardA,
    id: 3,
    title: "新卡片",
    prompt_text: "新提示词",
    category_ids: [],
    categories: [],
  };
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/prompt-cards" && method === "POST") {
      return new Response(JSON.stringify(cardC), { status: 201 });
    }
    if (url.includes("/api/prompt-cards") && method === "GET") {
      return new Response(JSON.stringify({ items: [cardA, cardB] }), {
        status: 200,
      });
    }
    if (url.includes("/api/categories") && method === "GET") {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  const user = userEvent.setup();
  const scrollToMock = vi
    .spyOn(window, "scrollTo")
    .mockImplementation(() => {});
  renderLibrary(vi.fn(), { ...defaultLibraryFilters, query: "新" });

  await user.click(await screen.findByRole("button", { name: "新增提示词" }));
  expect(screen.getByRole("dialog", { name: "新增提示词" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("标题"), "新卡片");
  await user.type(screen.getByLabelText("提示词正文"), "新提示词");
  await user.upload(
    screen.getByLabelText("上传示例图"),
    new File(["image"], "one.jpg", { type: "image/jpeg" }),
  );
  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  expect(await screen.findByText(cardC.title)).toBeInTheDocument();
  expect(screen.getByLabelText("搜索提示词")).toHaveValue("新");
  expect(scrollToMock).not.toHaveBeenCalled();
  expect(
    fetchMock.mock.calls.filter(
      ([input]) => String(input) === "/api/prompt-cards",
    ),
  ).toHaveLength(2);
});

test("卡片菜单打开编辑抽屉并回填，保存后替换原实体", async () => {
  const editedCard = { ...cardB, title: "赛博城市 2" };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/prompt-cards/2" && method === "PUT") {
      return new Response(JSON.stringify(editedCard), { status: 200 });
    }
    if (url.includes("/api/prompt-cards") && method === "GET") {
      return new Response(JSON.stringify({ items: [cardA, cardB] }), {
        status: 200,
      });
    }
    if (url.includes("/api/categories") && method === "GET") {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  const user = userEvent.setup();
  renderLibrary();

  await user.click(
    await screen.findByRole("button", { name: "赛博城市的更多操作" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "编辑" }));
  expect(screen.getByRole("dialog", { name: "编辑提示词" })).toBeInTheDocument();
  const title = screen.getByLabelText("标题");
  expect(title).toHaveValue("赛博城市");
  await user.clear(title);
  await user.type(title, editedCard.title);
  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  expect(await screen.findByText(editedCard.title)).toBeInTheDocument();
  expect(screen.queryByText(cardB.title)).not.toBeInTheDocument();
});

test("卡片菜单支持 Escape、点击外部关闭并恢复触发按钮焦点", async () => {
  const user = userEvent.setup();
  renderLibrary();
  const trigger = await screen.findByRole("button", {
    name: "赛博城市的更多操作",
  });

  await user.click(trigger);
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  await user.click(screen.getByRole("heading", { name: "赛博城市" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("点击另一张卡的菜单按钮时由新按钮保留焦点", async () => {
  const user = userEvent.setup();
  renderLibrary();
  const oldTrigger = await screen.findByRole("button", {
    name: "江南烟雨的更多操作",
  });
  const newTrigger = screen.getByRole("button", {
    name: "赛博城市的更多操作",
  });

  await user.click(oldTrigger);
  expect(oldTrigger).toHaveAttribute("aria-expanded", "true");
  await user.click(newTrigger);

  expect(oldTrigger).toHaveAttribute("aria-expanded", "false");
  expect(newTrigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByRole("menu")).toHaveLength(1);
  expect(newTrigger).toHaveFocus();
});

test("取消删除时不发送请求", async () => {
  const fetchMock = mockDeleteResponse(204);
  const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  renderLibrary();

  await openCyberDelete(user);

  expect(confirmMock).toHaveBeenCalledWith(
    "确定删除这个提示词？删除后无法恢复。",
  );
  expect(
    fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
  ).toBe(false);
});

test("删除成功后从列表移除卡片", async () => {
  mockDeleteResponse(204);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  renderLibrary();

  await openCyberDelete(user);

  await waitFor(() =>
    expect(screen.queryByText("赛博城市")).not.toBeInTheDocument(),
  );
});

test.each([
  [404, "提示词卡片不存在", "提示词卡片已不存在", false],
  [409, "该提示词存在生成历史，无法删除", "该提示词存在生成历史，无法删除", true],
] as const)(
  "删除错误状态 %s 显示明确反馈",
  async (status, detail, message, keepsCard) => {
    mockDeleteResponse(status, detail);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderLibrary();

    await openCyberDelete(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(Boolean(screen.queryByText("赛博城市"))).toBe(keepsCard);
  },
);

test("删除返回 500 时隐藏后端 detail 并显示安全提示", async () => {
  mockDeleteResponse(500, "内部数据库路径 C:\\private\\prompt.db");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  renderLibrary();

  await openCyberDelete(user);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("删除提示词失败，请稍后重试");
  expect(alert).not.toHaveTextContent("内部数据库路径");
});

test("未知删除错误显示安全提示并保留卡片", async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/prompt-cards/2" && method === "DELETE") {
      throw new Error("network secret");
    }
    if (url.includes("/api/prompt-cards") && method === "GET") {
      return new Response(JSON.stringify({ items: [cardA, cardB] }), { status: 200 });
    }
    if (url.includes("/api/categories") && method === "GET") {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  renderLibrary();

  await openCyberDelete(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "删除提示词失败，请稍后重试",
  );
  expect(screen.getByText("赛博城市")).toBeInTheDocument();
});

test("删除请求进行中禁用卡片菜单并防止重复请求", async () => {
  const deferred = deferredResponse();
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/prompt-cards/2" && method === "DELETE") {
      return deferred.promise;
    }
    if (url.includes("/api/prompt-cards") && method === "GET") {
      return new Response(JSON.stringify({ items: [cardA, cardB] }), { status: 200 });
    }
    if (url.includes("/api/categories") && method === "GET") {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  renderLibrary();

  await openCyberDelete(user);

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "赛博城市的更多操作" }),
    ).toBeDisabled(),
  );
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
  ).toHaveLength(1);
  deferred.resolve(new Response(null, { status: 204 }));
  await waitFor(() =>
    expect(screen.queryByText("赛博城市")).not.toBeInTheDocument(),
  );
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

test("点击封面可打开全屏大图预览", async () => {
  const user = userEvent.setup();
  renderLibrary();

  await user.click(await screen.findByRole("button", { name: "预览 赛博城市" }));
  const dialog = screen.getByRole("dialog", { name: "大图预览" });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByText("1/2")).toBeInTheDocument();
  expect(screen.getByText("1/2")).toHaveAttribute("title", "赛博城市");
  expect(dialog.querySelector("img")).toHaveAttribute(
    "src",
    "/media/prompt-images/0002-01.png",
  );
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
