import { afterEach, expect, test, vi } from "vitest";

import { generateImage } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
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
