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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [logoutFailure, setLogoutFailure] = useState<LogoutFailure | null>(null);
  const currentTokenRef = useRef<string | null>(token);
  currentTokenRef.current = token;

  const login = useCallback(async (password: string) => {
    setToken(await requestLogin(password));
  }, []);

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
  }, [token]);

  const clearToken = useCallback((expectedToken: string) => {
    setToken((currentToken) => (
      currentToken === expectedToken ? null : currentToken
    ));
  }, []);

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
