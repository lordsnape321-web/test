"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import { storage } from "@/lib/storage";

export type AppUser = {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: string; // "player" | "owner"
  avatarColor: string;
  avatarUrl: string;
  defaultCity: string;
  level: string;
  position: string;
  matchesPlayed: number;
};

export type SignupData = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: "player" | "owner";
  level?: string;
  position?: string;
  defaultCity?: string;
  avatarUrl?: string;
};

type Ctx = {
  user: AppUser | null;
  loading: boolean;
  isOwner: boolean;
  isPlayer: boolean;
  login: (email: string, password: string) => Promise<AppUser>;
  signup: (data: SignupData) => Promise<AppUser>;
  logout: () => void;
  refresh: () => Promise<void>;
  updateProfile: (patch: Partial<AppUser>) => Promise<AppUser>;
};

const UserCtx = createContext<Ctx>({
  user: null,
  loading: true,
  isOwner: false,
  isPlayer: false,
  login: async () => {
    throw new Error("not ready");
  },
  signup: async () => {
    throw new Error("not ready");
  },
  logout: () => {},
  refresh: async () => {},
  updateProfile: async () => {
    throw new Error("not ready");
  },
});

export function useUser() {
  return useContext(UserCtx);
}

const SESSION_KEY = "futsal_session_user_id";

function normalizeUser(u: AppUser): AppUser {
  return {
    ...u,
    avatarUrl: (u as Partial<AppUser>).avatarUrl ?? "",
    defaultCity: (u as Partial<AppUser>).defaultCity ?? "All Cities",
  };
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const stored =
        typeof window !== "undefined"
          ? Number(storage.get(SESSION_KEY) || "")
          : 0;
      if (!stored) {
        setUser(null);
        return;
      }
      const res = await apiFetch("/api/users");
      const data = await res.json();
      const found: AppUser | undefined = (data.users ?? []).find(
        (u: AppUser) => u.id === stored
      );
      if (found) setUser(normalizeUser(found));
      else {
        setUser(null);
        storage.remove(SESSION_KEY);
      }
    } catch {
      // stay logged out on network error
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const persist = (u: AppUser) => {
    setUser(normalizeUser(u));
    try {
      storage.set(SESSION_KEY, String(u.id));
    } catch {}
  };

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    persist(data.user);
    return data.user as AppUser;
  }, []);

  const signup = useCallback(async (form: SignupData) => {
    const res = await apiFetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Signup failed");
    persist(data.user);
    return data.user as AppUser;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    try {
      storage.remove(SESSION_KEY);
    } catch {}
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<AppUser>) => {
      if (!user) throw new Error("Not logged in");
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      const normalized = normalizeUser(data.user as AppUser);
      setUser(normalized);
      return normalized;
    },
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      isOwner: user?.role === "owner",
      isPlayer: user?.role !== "owner",
      login,
      signup,
      logout,
      refresh,
      updateProfile,
    }),
    [user, loading, login, signup, logout, refresh, updateProfile]
  );

  return <UserCtx.Provider value={value}>{children}</UserCtx.Provider>;
}
