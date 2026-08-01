import { useEffect, useState } from "react";

import { ApiError, getWelcome } from "../api";
import { useAuth } from "../auth/AuthContext";
import { LogoutButton } from "./LogoutButton";

export function WelcomeView({ token }: { token: string }) {
  const { clearToken } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getWelcome(token)
      .then((nextMessage) => {
        if (!cancelled) setMessage(nextMessage);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ApiError && requestError.status === 401) {
          clearToken();
          return;
        }
        if (!cancelled) setError("欢迎信息加载失败");
      });

    return () => {
      cancelled = true;
    };
  }, [clearToken, token]);

  return (
    <main>
      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
      <LogoutButton />
    </main>
  );
}
