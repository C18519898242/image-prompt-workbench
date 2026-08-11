import { afterEach, expect, test, vi } from "vitest";

import type { PromptCard } from "./api";
import {
  appendUploadImages,
  buildPromptCardMutation,
  initialEditorImages,
  moveEditorImage,
  removeEditorImage,
  validateSelectedFiles,
} from "./promptCardEditor";
import type { EditorImage } from "./promptCardEditor";

const cardB: PromptCard = {
  id: 2,
  title: "卡片 B",
  prompt_text: "提示词 B",
  sort_order: 2,
  category_ids: [1],
  categories: [{ id: 1, name: "人物", sort_order: 1 }],
  image_count: 2,
  example_image_path: "prompt-images/card-b-01.jpg",
  images: [
    { index: 1, path: "prompt-images/card-b-01.jpg", url: "/media/prompt-images/card-b-01.jpg" },
    { index: 2, path: "prompt-images/card-b-02.png", url: "/media/prompt-images/card-b-02.png" },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test("编辑卡片初始化为 existing 图片", () => {
  const images = initialEditorImages(cardB);

  expect(images.map((image) => image.kind)).toEqual(["existing", "existing"]);
  expect(images.filter((image) => image.kind === "existing").map((image) => image.imageIndex)).toEqual([1, 2]);
  expect(images.map((image) => image.name)).toEqual(["card-b-01.jpg", "card-b-02.png"]);
});

test("混排图片生成连续上传索引", () => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "upload-1") });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:upload-1") });
  const existing = initialEditorImages(cardB);
  const file = new File(["x"], "new.png", { type: "image/png" });
  const mixed = moveEditorImage(appendUploadImages(existing, [file]), 2, 1);
  const request = buildPromptCardMutation("标题", "提示词", mixed);

  expect(request.image_manifest).toEqual([
    { kind: "existing", image_index: 1 },
    { kind: "upload", file_index: 0 },
    { kind: "existing", image_index: 2 },
  ]);
  expect(request.new_images).toEqual([file]);
  expect(URL.createObjectURL).toHaveBeenCalledWith(file);
});

test("重复上传 id 不影响上传索引和文件顺序", () => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "duplicate-id") });
  vi.stubGlobal("URL", { createObjectURL: vi.fn((file: File) => `blob:${file.name}`) });
  const first = new File(["first"], "first.png", { type: "image/png" });
  const second = new File(["second"], "second.jpg", { type: "image/jpeg" });
  const images = appendUploadImages([], [first, second]);

  const request = buildPromptCardMutation("标题", "提示词", images);

  expect(request.image_manifest).toEqual([
    { kind: "upload", file_index: 0 },
    { kind: "upload", file_index: 1 },
  ]);
  expect(request.new_images).toEqual([first, second]);
});

test("移动越界保持原数组，删除按 id 生效", () => {
  const images = initialEditorImages(cardB);

  expect(moveEditorImage(images, 0, -1)).toBe(images);
  expect(moveEditorImage(images, 1, 1)).toBe(images);
  expect(removeEditorImage(images, images[0].id)).toEqual([images[1]]);
});

function sizedFile(name: string, type: string, size: number): File {
  return { name, type, size } as File;
}

const twentyExisting: EditorImage[] = Array.from({ length: 20 }, (_, index) => ({
  kind: "existing" as const,
  id: `existing-${index}`,
  imageIndex: index + 1,
  name: `${index}.jpg`,
  previewUrl: `/media/${index}.jpg`,
}));

test.each([
  [[sizedFile("a.gif", "image/gif", 1)], [], "仅支持 JPG 和 PNG 图片"],
  [[sizedFile("a.jpg", "image/jpeg", 20 * 1024 * 1024 + 1)], [], "单张图片不能超过 20 MB"],
  [[sizedFile("a.jpg", "image/jpeg", 1)], twentyExisting, "每张卡片最多上传 20 张图片"],
  [[sizedFile("b.jpg", "image/jpeg", 11 * 1024 * 1024)], [{
    kind: "upload" as const,
    id: "a",
    file: sizedFile("a.jpg", "image/jpeg", 90 * 1024 * 1024),
    name: "a.jpg",
    previewUrl: "blob:a",
  }], "单次上传总量不能超过 100 MB"],
])("校验文件选择限制", (files, current, message) => {
  expect(validateSelectedFiles(files, current)).toBe(message);
});

test("合法 JPG 和 PNG 文件通过快速校验", () => {
  expect(validateSelectedFiles([
    sizedFile("a.jpg", "image/jpeg", 100),
    sizedFile("b.png", "image/png", 100),
  ], [])).toBeNull();
});

test.each([
  [[sizedFile("a.jpg", "image/jpeg", 20 * 1024 * 1024)], [], "单张图片恰好 20 MB"],
  [[sizedFile("a.jpg", "image/jpeg", 10 * 1024 * 1024)], [{
    kind: "upload" as const,
    id: "prior-upload",
    file: sizedFile("prior.jpg", "image/jpeg", 90 * 1024 * 1024),
    name: "prior.jpg",
    previewUrl: "blob:prior",
  }], "累计上传恰好 100 MB"],
  [[sizedFile("a.jpg", "image/jpeg", 1)], twentyExisting.slice(0, 19), "图片数量恰好 20 张"],
])("边界值通过快速校验：%s", (files, current) => {
  expect(validateSelectedFiles(files, current)).toBeNull();
});
