export type LoginResponse = { token: string };
export type WelcomeResponse = { message: string };

export type PromptCardImage = {
  index: number;
  /** 相对 data/ 的路径，如 prompt-images/0001-01.jpg */
  path: string;
  /** 同源公开 URL，如 /media/prompt-images/0001-01.jpg */
  url: string;
};

export type Category = {
  id: number;
  name: string;
  sort_order: number;
};

export type PromptCard = {
  id: number;
  title: string;
  prompt_text: string;
  sort_order: number;
  category_ids: number[];
  categories: Category[];
  image_count: number;
  example_image_path: string;
  images: PromptCardImage[];
};

export type PromptCardListResponse = {
  items: PromptCard[];
};

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function login(password: string): Promise<string> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const result = await parseResponse<LoginResponse>(response);
  return result.token;
}

export async function getWelcome(token: string): Promise<string> {
  const response = await fetch("/api/welcome", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await parseResponse<WelcomeResponse>(response);
  return result.message;
}

export async function getPromptCards(token: string): Promise<PromptCard[]> {
  const response = await fetch("/api/prompt-cards", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await parseResponse<PromptCardListResponse>(response);
  return result.items;
}

export async function getCategories(token: string): Promise<Category[]> {
  const response = await fetch("/api/categories", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await parseResponse<{ items: Category[] }>(response);
  return result.items;
}

export async function logout(token: string): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  await parseResponse<void>(response);
}

export type GenerationHistoryItem = {
  id: number;
  prompt_card_id: number;
  title: string;
  image_path: string;
  url: string;
  model: string;
  aspect_ratio: string;
  resolution: string;
  created_at: number;
};

export type GenerationHistoryListResponse = {
  items: GenerationHistoryItem[];
};

export async function getGenerationHistories(
  token: string,
  options?: { prompt_card_id?: number },
): Promise<GenerationHistoryItem[]> {
  const params = new URLSearchParams();
  if (options?.prompt_card_id != null) {
    params.set("prompt_card_id", String(options.prompt_card_id));
  }
  const query = params.toString();
  const response = await fetch(
    `/api/generation-history${query ? `?${query}` : ""}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const result = await parseResponse<GenerationHistoryListResponse>(response);
  return result.items;
}

export async function deleteGenerationHistory(
  token: string,
  historyId: number,
): Promise<void> {
  const response = await fetch(`/api/generation-history/${historyId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await parseResponse<void>(response);
}
