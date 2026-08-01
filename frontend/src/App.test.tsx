import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import App from "./App";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { WelcomeView } from "./components/WelcomeView";

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

beforeEach(() => {
  vi.restoreAllMocks();
});

test("logs in, loads the protected welcome message, and logs out", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-1" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "欢迎使用 Image Prompt Workbench" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(await screen.findByText("欢迎使用 Image Prompt Workbench")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "退出" }));
  expect(screen.getByLabelText("密码")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test("returns to login when the welcome API returns 401", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-1" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }));
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(await screen.findByLabelText("密码")).toBeInTheDocument();
});

test("does not let a stale welcome 401 clear a later session", async () => {
  const oldWelcome = deferred<Response>();
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-old" }), { status: 200 }))
    .mockImplementationOnce(() => oldWelcome.promise)
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-new" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "new session" }), { status: 200 }));
  const user = userEvent.setup();
  const oldPassword = crypto.randomUUID();
  const newPassword = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), oldPassword);
  await user.click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  await user.click(screen.getByRole("button", { name: "退出" }));
  await user.type(screen.getByLabelText("密码"), newPassword);
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByText("new session")).toBeInTheDocument();

  oldWelcome.resolve(new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText("new session")).toBeInTheDocument();
});

test("does not clear the current token for a stale welcome 401", async () => {
  const oldWelcome = deferred<Response>();
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => oldWelcome.promise)
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-new" }), { status: 200 }));
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  render(
    <AuthProvider>
      <CurrentSession password={password} />
      <WelcomeView token="token-old" />
    </AuthProvider>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "start current session" }));
  expect(await screen.findByTestId("current-token")).toHaveTextContent("token-new");

  oldWelcome.resolve(new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByTestId("current-token")).toHaveTextContent("token-new");
});

test("does not let a delayed old logout clear a later session", async () => {
  const oldLogout = deferred<Response>();
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-old" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "old session" }), { status: 200 }))
    .mockImplementationOnce(() => oldLogout.promise)
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-new" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "new session" }), { status: 200 }));
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
  expect(await screen.findByText("old session")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await user.click(screen.getByRole("button", { name: "start newer session" }));
  expect(await screen.findByText("new session")).toBeInTheDocument();

  oldLogout.resolve(new Response(null, { status: 204 }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText("new session")).toBeInTheDocument();
});

test("shows the current session retry error after a stale logout failure", async () => {
  const oldLogout = deferred<Response>();
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-old" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "old session" }), { status: 200 }))
    .mockImplementationOnce(() => oldLogout.promise)
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-new" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "new session" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Server error" }), { status: 503 }));
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
  expect(await screen.findByText("old session")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await user.click(screen.getByRole("button", { name: "start newer session" }));
  expect(await screen.findByText("new session")).toBeInTheDocument();

  oldLogout.resolve(new Response(JSON.stringify({ detail: "Server error" }), { status: 503 }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("退出登录失败，请检查网络后重试");
  expect(screen.getByText("new session")).toBeInTheDocument();
});

test("keeps the session and offers retry when logout fails", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-1" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "active session" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Server error" }), { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const user = userEvent.setup();
  const password = crypto.randomUUID();

  renderApp();
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByText("active session")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "退出" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("退出登录失败，请检查网络后重试");
  expect(screen.getByText("active session")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重试退出登录" }));
  expect(await screen.findByLabelText("密码")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
