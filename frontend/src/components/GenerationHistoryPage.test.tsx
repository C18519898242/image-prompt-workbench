import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import {
  displayHistoryTitle,
  filterHistoryItems,
  formatHistoryDateTime,
  GenerationHistoryPage,
  type HistoryFilters,
  defaultHistoryFilters,
} from "./GenerationHistoryPage";
import type { GenerationHistoryItem, PromptCard } from "../api";

const itemA: GenerationHistoryItem = {
  id: 1,
  prompt_card_id: 10,
  title: "江南烟雨 1722930000",
  image_path: "generated-images/a.png",
  url: "/media/generated-images/a.png",
  model: "Nano Banana 2",
  aspect_ratio: "4:3",
  resolution: "1K",
  created_at: 1722930000,
};

const itemB: GenerationHistoryItem = {
  id: 2,
  prompt_card_id: 11,
  title: "赛博城市 1722931000",
  image_path: "generated-images/b.png",
  url: "/media/generated-images/b.png",
  model: "Nano Banana 2",
  aspect_ratio: "16:9",
  resolution: "2K",
  created_at: 1722931000,
};

const itemC: GenerationHistoryItem = {
  id: 3,
  prompt_card_id: 10,
  title: "江南烟雨 1722800000",
  image_path: "generated-images/c.png",
  url: "/media/generated-images/c.png",
  model: "Other Model",
  aspect_ratio: "4:3",
  resolution: "1K",
  created_at: 1722800000,
};

const cardJiangnan: PromptCard = {
  id: 10,
  title: "江南烟雨",
  prompt_text: "水墨山水",
  sort_order: 1,
  category_ids: [],
  categories: [],
  image_count: 1,
  example_image_path: "prompt-images/10.jpg",
  images: [],
};

const cardCyber: PromptCard = {
  id: 11,
  title: "赛博城市",
  prompt_text: "霓虹夜景",
  sort_order: 2,
  category_ids: [],
  categories: [],
  image_count: 1,
  example_image_path: "prompt-images/11.jpg",
  images: [],
};

function mockHistoryApis(options?: {
  histories?: GenerationHistoryItem[] | ((url: string) => GenerationHistoryItem[]);
  cards?: PromptCard[];
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/prompt-cards") && method === "GET") {
      return new Response(
        JSON.stringify({ items: options?.cards ?? [cardJiangnan, cardCyber] }),
        { status: 200 },
      );
    }
    if (url.includes("/api/generation-history/") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (url.includes("/api/generation-history") && method === "GET") {
      const items =
        typeof options?.histories === "function"
          ? options.histories(url)
          : (options?.histories ?? [itemA, itemB]);
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
}

function renderHistory() {
  return render(
    <AuthProvider>
      <GenerationHistoryPage token="token-1" />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test("displayHistoryTitle strips trailing created_at timestamp", () => {
  expect(displayHistoryTitle(itemA)).toBe("江南烟雨");
});

test("formatHistoryDateTime formats unix seconds", () => {
  const text = formatHistoryDateTime(itemA.created_at);
  expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("filterHistoryItems filters by query, model, ratio and sort", () => {
  const base: HistoryFilters = { ...defaultHistoryFilters };
  expect(filterHistoryItems([itemA, itemB, itemC], base).map((i) => i.id)).toEqual([
    2, 1, 3,
  ]);

  expect(
    filterHistoryItems([itemA, itemB, itemC], {
      ...base,
      query: "江南",
    }).map((i) => i.id),
  ).toEqual([1, 3]);

  expect(
    filterHistoryItems([itemA, itemB, itemC], {
      ...base,
      model: "Other Model",
    }).map((i) => i.id),
  ).toEqual([3]);

  expect(
    filterHistoryItems([itemA, itemB, itemC], {
      ...base,
      aspectRatio: "16:9",
    }).map((i) => i.id),
  ).toEqual([2]);

  expect(
    filterHistoryItems([itemA, itemB, itemC], {
      ...base,
      sort: "oldest",
    }).map((i) => i.id),
  ).toEqual([3, 1, 2]);
});

test("loads history gallery and opens detail panel", async () => {
  mockHistoryApis();

  const user = userEvent.setup();
  renderHistory();

  expect(await screen.findByRole("heading", { name: "生成历史" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看 江南烟雨" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看 赛博城市" })).toBeInTheDocument();
  expect(screen.getByLabelText("提示词卡片筛选")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "江南烟雨" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "赛博城市" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "查看 江南烟雨" }));

  const detail = screen.getByLabelText("历史详情");
  expect(within(detail).getByRole("heading", { name: "江南烟雨" })).toBeInTheDocument();
  expect(within(detail).getByText("Nano Banana 2")).toBeInTheDocument();
  expect(within(detail).getByText("4:3")).toBeInTheDocument();
  expect(within(detail).getByText("1K")).toBeInTheDocument();
  // 默认按最新生成排序：赛博城市(2) 在前，江南烟雨(1) 为第 2 条
  expect(within(detail).getByText((_, node) => node?.textContent === "2 / 2")).toBeInTheDocument();
  // 左侧画廊只选中，不打开全屏
  expect(screen.queryByRole("dialog", { name: "大图预览" })).not.toBeInTheDocument();
});

test("filters gallery by search query", async () => {
  mockHistoryApis();

  const user = userEvent.setup();
  renderHistory();
  await screen.findByRole("button", { name: "查看 江南烟雨" });

  await user.type(screen.getByLabelText("搜索生成历史"), "赛博");
  expect(screen.queryByRole("button", { name: "查看 江南烟雨" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看 赛博城市" })).toBeInTheDocument();
});

test("filters history by prompt card via generation-history API", async () => {
  const fetchMock = mockHistoryApis({
    histories: (url) => {
      if (url.includes("prompt_card_id=10")) {
        return [itemA, itemC];
      }
      if (url.includes("prompt_card_id=")) {
        return [];
      }
      return [itemA, itemB, itemC];
    },
  });

  const user = userEvent.setup();
  renderHistory();
  await screen.findByRole("button", { name: "查看 赛博城市" });

  await user.selectOptions(screen.getByLabelText("提示词卡片筛选"), "10");

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/generation-history?prompt_card_id=10"),
      ),
    ).toBe(true);
  });
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "查看 赛博城市" })).not.toBeInTheDocument();
  });
  expect(screen.getAllByRole("button", { name: /查看 江南烟雨/ })).toHaveLength(2);
});

test("deletes selected history and refreshes gallery", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  let items = [itemA, itemB];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/prompt-cards") && method === "GET") {
      return new Response(
        JSON.stringify({ items: [cardJiangnan, cardCyber] }),
        { status: 200 },
      );
    }
    if (url.includes("/api/generation-history/1") && method === "DELETE") {
      items = items.filter((item) => item.id !== 1);
      return new Response(null, { status: 204 });
    }
    if (url.includes("/api/generation-history") && method === "GET") {
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });

  const user = userEvent.setup();
  renderHistory();
  await user.click(await screen.findByRole("button", { name: "查看 江南烟雨" }));
  await user.click(screen.getByRole("button", { name: "删除" }));

  expect(confirmSpy).toHaveBeenCalled();
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "查看 江南烟雨" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "查看 赛博城市" })).toBeInTheDocument();
  expect(screen.getByLabelText("历史详情")).toBeInTheDocument();
  expect(screen.getByText("选择一张图片查看详情")).toBeInTheDocument();
});

test("shows empty state when there is no history", async () => {
  mockHistoryApis({ histories: [] });

  renderHistory();
  expect(await screen.findByText("暂无生成历史")).toBeInTheDocument();
  expect(screen.getByText("选择一张图片查看详情")).toBeInTheDocument();
});

test("reserves right panel when nothing is selected", async () => {
  mockHistoryApis();

  renderHistory();
  await screen.findByRole("button", { name: "查看 江南烟雨" });
  expect(screen.getByLabelText("历史详情")).toBeInTheDocument();
  expect(screen.getByText("选择一张图片查看详情")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "下载" })).not.toBeInTheDocument();
});

test("gallery image only selects and does not open lightbox", async () => {
  mockHistoryApis();
  const user = userEvent.setup();
  renderHistory();

  await user.click(await screen.findByRole("button", { name: "查看 江南烟雨" }));
  expect(within(screen.getByLabelText("历史详情")).getByRole("heading", {
    name: "江南烟雨",
  })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "大图预览" })).not.toBeInTheDocument();
});

test("opens fullscreen lightbox from detail image", async () => {
  mockHistoryApis();
  const user = userEvent.setup();
  renderHistory();

  await user.click(await screen.findByRole("button", { name: "查看 江南烟雨" }));
  await user.click(screen.getByRole("button", { name: "全屏预览" }));

  const lightbox = screen.getByRole("dialog", { name: "大图预览" });
  expect(lightbox).toBeInTheDocument();
  expect(lightbox.querySelector("img")).toHaveAttribute(
    "src",
    "/media/generated-images/a.png",
  );
  expect(
    within(lightbox).getByRole("button", { name: "下载" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "上一张" }));
  await waitFor(() => {
    expect(
      screen.getByRole("dialog", { name: "大图预览" }).querySelector("img"),
    ).toHaveAttribute("src", "/media/generated-images/b.png");
  });
});

test("downloads current image from lightbox top bar", async () => {
  mockHistoryApis();
  const user = userEvent.setup();

  renderHistory();
  await user.click(await screen.findByRole("button", { name: "查看 江南烟雨" }));
  await user.click(screen.getByRole("button", { name: "全屏预览" }));

  const lightbox = screen.getByRole("dialog", { name: "大图预览" });
  const clickSpy = vi.fn();
  const removeSpy = vi.fn();
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    ((tag: string, options?: ElementCreationOptions) => {
      if (tag === "a") {
        return {
          href: "",
          download: "",
          rel: "",
          click: clickSpy,
          remove: removeSpy,
        } as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tag, options);
    }) as typeof document.createElement,
  );
  vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);

  await user.click(within(lightbox).getByRole("button", { name: "下载" }));
  expect(clickSpy).toHaveBeenCalled();
});
