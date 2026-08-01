import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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

  const login = useCallback(async (password: string) => {
    setToken(await requestLogin(password));
  }, []);

  const logout = useCallback(async () => {
    if (!token) return;

    const tokenBeingLoggedOut = token;
    setLogoutFailure((currentFailure) => (
      currentFailure?.token === tokenBeingLoggedOut ? null : currentFailure
    ));

    try {
      await requestLogout(tokenBeingLoggedOut);
      setToken((currentToken) => (
        currentToken === tokenBeingLoggedOut ? null : currentToken
      ));
      setLogoutFailure((currentFailure) => (
        currentFailure?.token === tokenBeingLoggedOut ? null : currentFailure
      ));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setToken((currentToken) => (
          currentToken === tokenBeingLoggedOut ? null : currentToken
        ));
        setLogoutFailure((currentFailure) => (
          currentFailure?.token === tokenBeingLoggedOut ? null : currentFailure
        ));
        return;
      }

      setLogoutFailure((currentFailure) => (
        currentFailure === null || currentFailure.token === tokenBeingLoggedOut
          ? {
              token: tokenBeingLoggedOut,
              message: "退出登录失败，请检查网络后重试",
            }
          : currentFailure
      ));
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
