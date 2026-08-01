import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import App from "./App";
import { AuthProvider } from "./auth/AuthContext";

function renderApp() {
  return render(
    <AuthProvider>
      <App />
    </AuthProvider>,
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
