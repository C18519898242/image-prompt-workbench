import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import {
  defaultLibraryFilters,
  PromptLibraryPage,
} from "./PromptLibraryPage";

const multiImageCard = {
  id: 1,
  title: "多图卡片",
  prompt_text: "完整提示词内容",
  sort_order: 1,
  category_ids: [] as number[],
  categories: [] as { id: number; name: string; sort_order: number }[],
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

function renderBrowser() {
  return render(
    <AuthProvider>
      <PromptLibraryPage
        token="token-1"
        filters={defaultLibraryFilters}
        onFiltersChange={vi.fn()}
        onUsePrompt={vi.fn()}
      />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/prompt-cards") && !url.includes("/images/")) {
      return new Response(JSON.stringify({ items: [multiImageCard] }), {
        status: 200,
      });
    }
    if (url.includes("/api/categories")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
});

test("显示首图和图片数量", async () => {
  renderBrowser();

  expect(await screen.findByText("共 2 张")).toBeInTheDocument();
  expect(screen.getByText("多图卡片")).toBeInTheDocument();
  expect(
    document.querySelector(".prompt-card-image-frame--4x3"),
  ).toBeInTheDocument();
  const images = document.querySelectorAll("img.prompt-card-image");
  expect(images[0]).toHaveAttribute("src", "/media/prompt-images/0001-01.jpg");
  expect(
    screen.getByRole("button", { name: "使用此提示词" }),
  ).toBeInTheDocument();
});

test("点击卡片封面后显示轮播和完整提示词", async () => {
  const user = userEvent.setup();
  renderBrowser();

  await user.click(await screen.findByRole("button", { name: "预览 多图卡片" }));

  const dialog = screen.getByRole("dialog");
  expect(dialog).toBeInTheDocument();
  expect(dialog).toHaveTextContent("完整提示词内容");
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  const stageImage = dialog.querySelector(".prompt-card-stage img");
  expect(stageImage).toHaveAttribute("src", "/media/prompt-images/0001-01.jpg");
  expect(screen.queryByRole("link", { name: "立即生成" })).not.toBeInTheDocument();
});

test("点击下一张后显示第二张序号", async () => {
  const user = userEvent.setup();
  renderBrowser();

  await user.click(await screen.findByRole("button", { name: "预览 多图卡片" }));
  await user.click(screen.getByRole("button", { name: "下一张" }));

  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  const stageImage = screen
    .getByRole("dialog")
    .querySelector(".prompt-card-stage img");
  expect(stageImage).toHaveAttribute("src", "/media/prompt-images/0001-02.jpg");
});

test("点击大图可打开预览并关闭", async () => {
  const user = userEvent.setup();
  renderBrowser();

  await user.click(await screen.findByRole("button", { name: "预览 多图卡片" }));
  await user.click(screen.getByRole("button", { name: "预览大图" }));

  const lightbox = screen.getByRole("dialog", { name: "大图预览" });
  expect(lightbox).toBeInTheDocument();
  expect(lightbox.querySelector("img")).toHaveAttribute(
    "src",
    "/media/prompt-images/0001-01.jpg",
  );

  await user.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(screen.queryByRole("dialog", { name: "大图预览" })).not.toBeInTheDocument();
});
