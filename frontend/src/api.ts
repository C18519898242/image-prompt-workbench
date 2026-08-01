export type LoginResponse = { token: string };
export type WelcomeResponse = { message: string };

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

export async function logout(token: string): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  await parseResponse<void>(response);
}
