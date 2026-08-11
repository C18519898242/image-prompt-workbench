import { afterEach, expect, test, vi } from "vitest";

import {
  ApiError,
  createPromptCard,
  deletePromptCard,
  generateImage,
  updatePromptCard,
} from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

test("createPromptCard 提交图片清单和文件", async () => {
  const card = { id: 3, title: "标题", prompt_text: "提示词", sort_order: 0, category_ids: [], categories: [], image_count: 1, example_image_path: "prompt-images/x-01.jpg", images: [] };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(card), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const file = new File(["image"], "one.jpg", { type: "image/jpeg" });

  await createPromptCard("token", {
    title: "标题",
    prompt_text: "提示词",
    image_manifest: [{ kind: "upload", file_index: 0 }],
    new_images: [file],
  });

  expect(fetchMock).toHaveBeenCalledWith("/api/prompt-cards", expect.objectContaining({
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: expect.any(FormData),
  }));
  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(JSON.parse(String(body.get("image_manifest")))).toEqual([{ kind: "upload", file_index: 0 }]);
  expect(body.getAll("new_images")).toEqual([file]);
});

test("updatePromptCard 使用 PUT 请求指定提示词卡片", async () => {
  const card = { id: 3, title: "标题", prompt_text: "提示词", sort_order: 0, category_ids: [], categories: [], image_count: 0, example_image_path: "", images: [] };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(card), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await updatePromptCard("token", 3, {
    title: "标题",
    prompt_text: "提示词",
    image_manifest: [],
    new_images: [],
  });

  expect(fetchMock).toHaveBeenCalledWith("/api/prompt-cards/3", expect.objectContaining({
    method: "PUT",
    headers: { Authorization: "Bearer token" },
    body: expect.any(FormData),
  }));
});

test("deletePromptCard 使用 DELETE 请求并处理 204 响应", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(deletePromptCard("token", 9)).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledWith("/api/prompt-cards/9", {
    method: "DELETE",
    headers: { Authorization: "Bearer token" },
  });
});

test("API 错误使用后端中文 detail", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ detail: "该提示词存在生成历史，无法删除" }), { status: 409 }),
  ));

  await expect(deletePromptCard("token", 9)).rejects.toMatchObject({
    status: 409,
    message: "该提示词存在生成历史，无法删除",
  } satisfies Partial<ApiError>);
});

test("generateImage 以 FormData 提交生成请求", async () => {
  const historyItem = {
    id: 42,
    prompt_card_id: 9,
    title: "测试生成",
    image_path: "generated/42.png",
    url: "/media/generated/42.png",
    model: "Nano Banana 2",
    aspect_ratio: "9:16",
    resolution: "2K",
    created_at: 1_700_000_000,
  };
  const referenceFile = new File(["ref"], "ref.png", { type: "image/png" });
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => historyItem,
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await generateImage("token", {
    prompt_card_id: 9,
    prompt: "最终提示词",
    model: "Nano Banana 2",
    aspect_ratio: "9:16",
    resolution: "2K",
    thinking_level: "high",
    reference_images: [referenceFile],
  });

  expect(result).toEqual(historyItem);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/generations",
    expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: expect.any(FormData),
    }),
  );
  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(body.get("prompt_card_id")).toBe("9");
  expect(body.get("prompt")).toBe("最终提示词");
  expect(body.get("model")).toBe("Nano Banana 2");
  expect(body.get("aspect_ratio")).toBe("9:16");
  expect(body.get("resolution")).toBe("2K");
  expect(body.get("thinking_level")).toBe("high");
  expect(body.getAll("reference_images")).toEqual([referenceFile]);
});
