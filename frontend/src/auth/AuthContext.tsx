import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ApiError, login as requestLogin, logout as requestLogout } from "../api";

const TOKEN_SESSION_KEY = "ipw.auth.token";

type LogoutFailure = {
  token: string;
  message: string;
};

type AuthContextValue = {
  token: string | null;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutError: string | null;
  clearToken: (expectedToken: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredToken(): string | null {
  try {
    const value = sessionStorage.getItem(TOKEN_SESSION_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    // 隐私模式等不可用 sessionStorage 时退回内存态
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_SESSION_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_SESSION_KEY);
    }
  } catch {
    // 忽略存储失败，仍保留内存中的 token
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => readStoredToken());
  const [logoutFailure, setLogoutFailure] = useState<LogoutFailure | null>(null);
  const currentTokenRef = useRef<string | null>(token);
  currentTokenRef.current = token;

  const setToken = useCallback((next: string | null | ((current: string | null) => string | null)) => {
    setTokenState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      if (resolved !== current) {
        writeStoredToken(resolved);
      }
      return resolved;
    });
  }, []);

  const login = useCallback(async (password: string) => {
    setToken(await requestLogin(password));
  }, [setToken]);

  const logout = useCallback(async () => {
    if (!token) return;

    const tokenBeingLoggedOut = token;
    setLogoutFailure(null);

    try {
      await requestLogout(tokenBeingLoggedOut);
      setToken((currentToken) => (
        currentToken === tokenBeingLoggedOut ? null : currentToken
      ));
      setLogoutFailure((currentFailure) => (
        currentFailure?.token === tokenBeingLoggedOut ? null : currentFailure
      ));
    } catch (error) {
      if (currentTokenRef.current !== tokenBeingLoggedOut) return;

      if (error instanceof ApiError && error.status === 401) {
        setToken((currentToken) => (
          currentToken === tokenBeingLoggedOut ? null : currentToken
        ));
        setLogoutFailure((currentFailure) => (
          currentFailure?.token === tokenBeingLoggedOut ? null : currentFailure
        ));
        return;
      }

      setLogoutFailure({
        token: tokenBeingLoggedOut,
        message: "退出登录失败，请检查网络后重试",
      });
    }
  }, [setToken, token]);

  const clearToken = useCallback((expectedToken: string) => {
    setToken((currentToken) => (
      currentToken === expectedToken ? null : currentToken
    ));
  }, [setToken]);

  const value = useMemo<AuthContextValue>(() => ({
    token,
    login,
    logout,
    logoutError: logoutFailure?.token === token ? logoutFailure.message : null,
    clearToken,
  }), [clearToken, login, logout, logoutFailure, token]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
