import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import App from "./App";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";

function renderApp() {
  return render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function LoginAgainButton({ password }: { password: string }) {
  const { login } = useAuth();
  return (
    <button type="button" onClick={() => void login(password)}>
      start newer session
    </button>
  );
}

function CurrentSession({ password }: { password: string }) {
  const { login, token } = useAuth();
  return (
    <>
      <button type="button" onClick={() => void login(password)}>
        start current session
      </button>
      <output data-testid="current-token">{token ?? "anonymous"}</output>
    </>
  );
}

function emptyCardsResponse() {
  return new Response(JSON.stringify({ items: [] }), { status: 200 });
}

function emptyCategoriesResponse() {
  return new Response(JSON.stringify({ items: [] }), { status: 200 });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function mockAuthedApis(options?: {
  cards?: Response | (() => Promise<Response>);
  categories?: Response;
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/login") && method === "POST") {
      return jsonResponse({ token: "token-1" });
    }
    if (url.includes("/api/categories")) {
      return options?.categories ?? emptyCategoriesResponse();
    }
    if (url.includes("/api/prompt-cards")) {
      if (typeof options?.cards === "function") {
        return options.cards();
      }
      return options?.cards ?? emptyCardsResponse();
    }
    if (url.includes("/api/auth/logout") && method === "POST") {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ detail: "Not found" }, 404);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

test("logs in, shows prompt library navigation, and logs out", async () => {
  const fetchMock = mockAuthedApis();
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(await screen.findByRole("navigation")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "提示词库" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "生成工作台" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "历史" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "☆ 收藏" })).not.toBeInTheDocument();
  expect(await screen.findByText("暂无提示词卡片")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  expect(screen.getByLabelText("密码")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalled();
});

test("returns to login when the prompt cards API returns 401", async () => {
  mockAuthedApis({
    cards: jsonResponse({ detail: "Unauthorized" }, 401),
  });
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(await screen.findByLabelText("密码")).toBeInTheDocument();
});

test("does not let a stale cards 401 clear a later session", async () => {
  const oldCards = deferred<Response>();
  let cardCalls = 0;
  let loginCount = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/login") && method === "POST") {
      loginCount += 1;
      return loginCount === 1
        ? jsonResponse({ token: "token-old" })
        : jsonResponse({ token: "token-new" });
    }
    if (url.includes("/api/categories")) {
      return emptyCategoriesResponse();
    }
    if (url.includes("/api/prompt-cards")) {
      cardCalls += 1;
      if (cardCalls === 1) {
        return oldCards.promise;
      }
      return emptyCardsResponse();
    }
    if (url.includes("/api/auth/logout") && method === "POST") {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ detail: "Not found" }, 404);
  });
  const user = userEvent.setup();
  const oldPassword = crypto.randomUUID();
  const newPassword = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), oldPassword);
  await user.click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());

  await user.click(screen.getByRole("button", { name: "退出" }));
  await user.type(screen.getByLabelText("密码"), newPassword);
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByText("暂无提示词卡片")).toBeInTheDocument();

  oldCards.resolve(jsonResponse({ detail: "Unauthorized" }, 401));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText("暂无提示词卡片")).toBeInTheDocument();
});

test("does not clear the current token for a stale cards 401", async () => {
  const oldCards = deferred<Response>();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/login") && method === "POST") {
      return jsonResponse({ token: "token-new" });
    }
    if (url.includes("/api/categories")) {
      return emptyCategoriesResponse();
    }
    if (url.includes("/api/prompt-cards")) {
      return oldCards.promise;
    }
    return jsonResponse({ detail: "Not found" }, 404);
  });
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  render(
    <AuthProvider>
      <CurrentSession password={password} />
      <AppShell token="token-old" />
    </AuthProvider>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "start current session" }));
  expect(await screen.findByTestId("current-token")).toHaveTextContent("token-new");

  oldCards.resolve(jsonResponse({ detail: "Unauthorized" }, 401));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByTestId("current-token")).toHaveTextContent("token-new");
});

test("does not let a delayed old logout clear a later session", async () => {
  const oldLogout = deferred<Response>();
  let loginCount = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/login") && method === "POST") {
      loginCount += 1;
      return loginCount === 1
        ? jsonResponse({ token: "token-old" })
        : jsonResponse({ token: "token-new" });
    }
    if (url.includes("/api/categories")) {
      return emptyCategoriesResponse();
    }
    if (url.includes("/api/prompt-cards")) {
      return emptyCardsResponse();
    }
    if (url.includes("/api/auth/logout") && method === "POST") {
      if (loginCount === 1) {
        return oldLogout.promise;
      }
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ detail: "Not found" }, 404);
  });
  const user = userEvent.setup();
  const oldPassword = crypto.randomUUID();
  const newPassword = crypto.randomUUID();

  render(
    <AuthProvider>
      <App />
      <LoginAgainButton password={newPassword} />
    </AuthProvider>,
  );
  await user.type(screen.getByLabelText("密码"), oldPassword);
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByText("暂无提示词卡片")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "start newer session" }));
  expect(await screen.findByText("暂无提示词卡片")).toBeInTheDocument();

  oldLogout.resolve(new Response(null, { status: 204 }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText("暂无提示词卡片")).toBeInTheDocument();
});

test("shows the current session retry error after a stale logout failure", async () => {
  const oldLogout = deferred<Response>();
  let loginCount = 0;
  let logoutCount = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/login") && method === "POST") {
      loginCount += 1;
      return loginCount === 1
        ? jsonResponse({ token: "token-old" })
        : jsonResponse({ token: "token-new" });
    }
    if (url.includes("/api/categories")) {
      return emptyCategoriesResponse();
    }
    if (url.includes("/api/prompt-cards")) {
      return emptyCardsResponse();
    }
    if (url.includes("/api/auth/logout") && method === "POST") {
      logoutCount += 1;
      if (logoutCount === 1) {
        return oldLogout.promise;
      }
      return jsonResponse({ detail: "Server error" }, 503);
    }
    return jsonResponse({ detail: "Not found" }, 404);
  });
  const user = userEvent.setup();
  const oldPassword = crypto.randomUUID();
  const newPassword = crypto.randomUUID();

  render(
    <AuthProvider>
      <App />
      <LoginAgainButton password={newPassword} />
    </AuthProvider>,
  );
  await user.type(screen.getByLabelText("密码"), oldPassword);
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByText("暂无提示词卡片")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  await user.click(screen.getByRole("button", { name: "start newer session" }));
  expect(await screen.findByText("暂无提示词卡片")).toBeInTheDocument();

  oldLogout.resolve(jsonResponse({ detail: "Server error" }, 503));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "退出登录失败，请检查网络后重试",
  );
  expect(screen.getByText("暂无提示词卡片")).toBeInTheDocument();
});

test("keeps the session and offers retry when logout fails", async () => {
  let logoutCount = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/login") && method === "POST") {
      return jsonResponse({ token: "token-1" });
    }
    if (url.includes("/api/categories")) {
      return emptyCategoriesResponse();
    }
    if (url.includes("/api/prompt-cards")) {
      return emptyCardsResponse();
    }
    if (url.includes("/api/auth/logout") && method === "POST") {
      logoutCount += 1;
      if (logoutCount === 1) {
        return jsonResponse({ detail: "Server error" }, 503);
      }
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ detail: "Not found" }, 404);
  });
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByText("暂无提示词卡片")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "退出登录失败，请检查网络后重试",
  );
  expect(screen.getByText("暂无提示词卡片")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重试退出登录" }));
  expect(await screen.findByLabelText("密码")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalled();
});

test("使用此提示词进入工作台占位并可返回", async () => {
  const card = {
    id: 9,
    title: "测试卡片",
    prompt_text: "测试提示词",
    sort_order: 1,
    category_ids: [] as number[],
    categories: [] as { id: number; name: string; sort_order: number }[],
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
  mockAuthedApis({
    // Response body 只能读一次，返回时需重新构造
    cards: async () => jsonResponse({ items: [card] }),
  });
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByRole("button", { name: "使用此提示词" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "使用此提示词" }));
  expect(
    screen.getByText("生成工作台即将推出。本页仅作为「使用此提示词」跳转占位。"),
  ).toBeInTheDocument();
  expect(screen.getByText("已选择提示词卡片 ID：9")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "返回提示词库" }));
  expect(await screen.findByText("测试卡片")).toBeInTheDocument();
});
