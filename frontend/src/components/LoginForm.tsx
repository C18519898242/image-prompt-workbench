import { useState, type FormEvent } from "react";

import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

export function LoginForm() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(password);
    } catch (error) {
      setError(error instanceof ApiError ? "密码错误" : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-logo" aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M9 3h6v2h1.5A2.5 2.5 0 0 1 19 7.5V9a5 5 0 0 1-2 4v3.5A2.5 2.5 0 0 1 14.5 19h-5A2.5 2.5 0 0 1 7 16.5V13a5 5 0 0 1-2-4V7.5A2.5 2.5 0 0 1 7.5 5H9V3Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M9 13h6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h1 className="login-title">Image Prompt Workbench</h1>
        <p className="login-subtitle">个人图像提示词与生成工作台</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="password">密码</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="请输入密码"
            required
          />
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
      <p className="login-footer">仅供个人使用</p>
    </main>
  );
}
