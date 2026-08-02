import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import { LoginForm } from "./LoginForm";

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test("登录页展示产品名、副标题与个人使用说明", () => {
  renderLogin();
  expect(
    screen.getByRole("heading", { name: "Image Prompt Workbench" }),
  ).toBeInTheDocument();
  expect(screen.getByText("个人图像提示词与生成工作台")).toBeInTheDocument();
  expect(screen.getByText("仅供个人使用")).toBeInTheDocument();
  expect(screen.getByLabelText("密码")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  expect(screen.queryByText(/注册|GitHub|Google|记住我/i)).not.toBeInTheDocument();
});

test("登录失败时在表单内显示错误", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }),
  );
  const user = userEvent.setup();
  renderLogin();
  await user.type(screen.getByLabelText("密码"), crypto.randomUUID());
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("密码错误");
});
