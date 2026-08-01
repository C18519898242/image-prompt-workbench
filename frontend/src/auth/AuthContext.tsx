import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { login as requestLogin, logout as requestLogout } from "../api";

type AuthContextValue = {
  token: string | null;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearToken: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);

  const value = useMemo<AuthContextValue>(() => ({
    token,
    login: async (password) => setToken(await requestLogin(password)),
    logout: async () => {
      if (token) {
        try {
          await requestLogout(token);
        } finally {
          setToken(null);
        }
      }
    },
    clearToken: () => setToken(null),
  }), [token]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
