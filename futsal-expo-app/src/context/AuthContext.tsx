import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  fetchUser,
  login as apiLogin,
  signup as apiSignup,
  updateProfile as apiUpdateProfile,
} from "@/api";
import { STORAGE_KEYS, initStorage, storage } from "@/lib/storage";
import type { User } from "@/lib/types";

/**
 * The native session mirrors the web app's UserProvider while using
 * AsyncStorage instead of localStorage. The server remains the source of truth:
 * a cached profile is painted immediately so returning players do not see a
 * login flash, then `/api/users/:id` refreshes it in the background.
 */

type AuthState = {
  user: User | null;
  /** False until storage is hydrated and the cached profile has been read. */
  ready: boolean;
  isOwner: boolean;
  isPlayer: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (input: {
    name: string;
    email: string;
    phone: string;
    password: string;
    role?: "player" | "owner";
    level?: string;
    position?: string;
    defaultCity?: string;
    avatarUrl?: string;
  }) => Promise<User>;
  signOut: () => Promise<void>;
  /** Re-read the profile after a payment, review, or profile edit. */
  refresh: () => Promise<void>;
  updateProfile: (patch: Partial<User> & { defaultCity?: string }) => Promise<User>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const persist = useCallback(async (next: User) => {
    setUser(next);
    // Keep the complete safe user response for an instant cold-start render.
    // Older builds wrote a numeric id here, and the hydration code below still
    // understands that format.
    await storage.set(STORAGE_KEYS.session, JSON.stringify(next));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await initStorage();
      const cached = storage.getCached(STORAGE_KEYS.session);
      let cachedUser: User | null = null;
      let cachedId: number | null = null;

      if (cached) {
        try {
          const parsed: unknown = JSON.parse(cached);
          if (parsed && typeof parsed === "object" && "id" in parsed) {
            const candidate = parsed as Partial<User>;
            if (typeof candidate.id === "number") {
              cachedUser = candidate as User;
              cachedId = candidate.id;
            }
          } else if (typeof parsed === "number") {
            cachedId = parsed;
          }
        } catch {
          const id = Number(cached);
          if (Number.isInteger(id) && id > 0) cachedId = id;
        }
      }

      if (!cancelled && cachedUser) setUser(cachedUser);
      // A full cached profile already contains the role, so it is safe to
      // render the right shell while the background refresh runs. An older
      // build only stored a numeric id; keep the app behind the auth loading
      // view until that id has been resolved, otherwise an owner could briefly
      // mount a player route with an unknown role.
      if (!cancelled && (!cachedId || cachedUser)) setReady(true);

      // Refresh after the first paint when the role is known. For legacy id-only
      // sessions, resolve the profile before marking auth ready. If that lookup
      // fails, discard the unverifiable id rather than guessing that it is a
      // player and exposing player navigation to an owner.
      if (cachedId) {
        try {
          const fresh = await fetchUser(cachedId);
          if (!cancelled) await persist(fresh);
        } catch {
          if (!cancelled && !cachedUser) await storage.remove(STORAGE_KEYS.session);
        } finally {
          if (!cancelled && !cachedUser) setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [persist]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user: next } = await apiLogin({ email, password });
      await persist(next);
      return next;
    },
    [persist],
  );

  const signUp = useCallback(
    async (input: {
      name: string;
      email: string;
      phone: string;
      password: string;
      role?: "player" | "owner";
      level?: string;
      position?: string;
      defaultCity?: string;
      avatarUrl?: string;
    }) => {
      const { user: next } = await apiSignup(input);
      await persist(next);
      return next;
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    setUser(null);
    await storage.remove(STORAGE_KEYS.session);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      await persist(await fetchUser(user.id));
    } catch {
      // A failed refresh should not erase a valid offline session.
    }
  }, [persist, user]);

  const updateProfile = useCallback(
    async (patch: Partial<User> & { defaultCity?: string }) => {
      if (!user) throw new Error("Not logged in");
      const next = await apiUpdateProfile(user.id, patch);
      await persist(next);
      return next;
    },
    [persist, user],
  );

  const isOwner = user?.role === "owner";
  const isPlayer = user?.role === "player";

  const value = useMemo(
    () => ({
      user,
      ready,
      isOwner,
      isPlayer,
      signIn,
      signUp,
      signOut,
      refresh,
      updateProfile,
    }),
    [user, ready, isOwner, isPlayer, signIn, signUp, signOut, refresh, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
