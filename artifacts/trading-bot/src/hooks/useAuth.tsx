import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken, setUnauthorizedHandler, type User } from "@/lib/api";

interface AuthContext {
  user: User | null;
  loading: boolean;
  signIn: (user: User, token: string) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    if (!getToken()) return;
    api<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(clear)
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const signIn = useCallback((u: User, token: string) => {
    setToken(token);
    setUser(u);
  }, []);

  const signOut = useCallback(() => {
    api("/auth/logout", { method: "POST" }).catch(() => {});
    clear();
  }, [clear]);

  return <Ctx.Provider value={{ user, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
