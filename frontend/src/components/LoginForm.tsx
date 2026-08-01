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
    <main>
      <h1>Image Prompt Workbench</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="password">密码</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "登录中..." : "登录"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
