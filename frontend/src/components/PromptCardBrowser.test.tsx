import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import { PromptCardBrowser } from "./PromptCardBrowser";

const multiImageCard = {
  id: 1,
  title: "多图卡片",
  prompt_text: "完整提示词内容",
  sort_order: 1,
  category_ids: [] as number[],
  image_count: 2,
  images: [
    { index: 1, url: "/api/prompt-cards/1/images/1" },
    { index: 2, url: "/api/prompt-cards/1/images/2" },
  ],
};

function renderBrowser() {
  return render(
    <AuthProvider>
      <PromptCardBrowser token="token-1" />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/prompt-cards") && !url.includes("/images/")) {
      return new Response(JSON.stringify({ items: [multiImageCard] }), {
        status: 200,
      });
    }
    if (url.includes("/images/")) {
      return new Response(new Blob(["image-bytes"], { type: "image/jpeg" }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
});

test("显示首图和图片数量", async () => {
  renderBrowser();

  expect(await screen.findByText("共 2 张")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "多图卡片" })).toBeInTheDocument();
});

test("点击卡片后显示轮播和完整提示词", async () => {
  const user = userEvent.setup();
  renderBrowser();

  await user.click(await screen.findByRole("button", { name: "多图卡片" }));

  const dialog = screen.getByRole("dialog");
  expect(dialog).toBeInTheDocument();
  expect(dialog).toHaveTextContent("完整提示词内容");
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
});

test("点击下一张后显示第二张序号", async () => {
  const user = userEvent.setup();
  renderBrowser();

  await user.click(await screen.findByRole("button", { name: "多图卡片" }));
  await user.click(screen.getByRole("button", { name: "下一张" }));

  expect(screen.getByText("2 / 2")).toBeInTheDocument();
});
