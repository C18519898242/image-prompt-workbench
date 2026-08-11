import type {
  PromptCard,
  PromptCardMutationRequest,
  PromptImageManifestItem,
} from "./api";

export type EditorImage =
  | {
    kind: "existing";
    id: string;
    imageIndex: number;
    name: string;
    previewUrl: string;
  }
  | {
    kind: "upload";
    id: string;
    file: File;
    name: string;
    previewUrl: string;
  };

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_COUNT = 20;

export function initialEditorImages(card: PromptCard | null): EditorImage[] {
  return card?.images.map((image) => ({
    kind: "existing" as const,
    id: `existing-${image.index}`,
    imageIndex: image.index,
    name: image.path.split("/").pop() || `图片 ${image.index}`,
    previewUrl: image.url,
  })) ?? [];
}

export function appendUploadImages(current: EditorImage[], files: File[]): EditorImage[] {
  return [
    ...current,
    ...files.map((file) => ({
      kind: "upload" as const,
      id: crypto.randomUUID(),
      file,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
    })),
  ];
}

export function moveEditorImage(images: EditorImage[], from: number, to: number): EditorImage[] {
  if (from < 0 || to < 0 || from >= images.length || to >= images.length || from === to) {
    return images;
  }
  const next = [...images];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function removeEditorImage(images: EditorImage[], id: string): EditorImage[] {
  return images.filter((image) => image.id !== id);
}

export function buildPromptCardMutation(
  title: string,
  promptText: string,
  images: EditorImage[],
): PromptCardMutationRequest {
  const imageManifest: PromptImageManifestItem[] = [];
  const newImages: File[] = [];

  for (const image of images) {
    if (image.kind === "existing") {
      imageManifest.push({ kind: "existing", image_index: image.imageIndex });
      continue;
    }
    imageManifest.push({ kind: "upload", file_index: newImages.length });
    newImages.push(image.file);
  }

  return { title, prompt_text: promptText, image_manifest: imageManifest, new_images: newImages };
}

export function validateSelectedFiles(files: File[], current: EditorImage[]): string | null {
  if (files.some((file) => !["image/jpeg", "image/png"].includes(file.type))) {
    return "仅支持 JPG 和 PNG 图片";
  }
  if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
    return "单张图片不能超过 20 MB";
  }
  if (current.length + files.length > MAX_IMAGE_COUNT) {
    return "每张卡片最多上传 20 张图片";
  }
  const existingUploadBytes = current.reduce(
    (total, image) => total + (image.kind === "upload" ? image.file.size : 0),
    0,
  );
  const selectedBytes = files.reduce((total, file) => total + file.size, 0);
  if (existingUploadBytes + selectedBytes > MAX_TOTAL_UPLOAD_BYTES) {
    return "单次上传总量不能超过 100 MB";
  }
  return null;
}
