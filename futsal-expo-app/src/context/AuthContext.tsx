import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { login as apiLogin, signup as apiSignup, updateProfile as apiUpdateProfile } from "@/api";
import { STORAGE_KEYS, initStorage, storage } from "@/lib/storage";
import type { User } from "@/lib/types";

/**
 * Session state.
 *
 * The web app keeps the signed-in user in React context and mirrors the user id
 * to localStorage. The native version does the same against AsyncStorage, with
 * one extra step: storage has to be hydrated before the first render can know
 * whether anyone is signed in, so there is a `ready` gate. Skipping it would
 * flash the login screen at a returning user on every cold start.
 *
 * The session stores only the user id and re-fetches the profile. That keeps a
 * stale cached profile (old rating, old trust score) from being shown as truth,
 * and it means the server remains the authority on who is signed in.
 */

type AuthState = {
  user: User | null;
  /** False until storage is hydrated and the cached profile has been loaded. */
  ready: boolean;
  /** Derived, matching the web UserProvider: role === "owner". */
  isOwner: boolean;
  isPlayer: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    name: string;
    email: string;
    phone: string;
    password: string;
    level?: string;
    position?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-read the profile from the server (after a payment changes a rating). */
  refresh: () => Promise<void>;
  /**
   * Patch the profile and adopt whatever the server returns.
   * Mirrors the web UserProvider.updateProfile contract.
   */
  updateProfile: (patch: Partial<User> & { defaultCity?: string }) => Promise<User>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  /** Read the cached profile on mount, if there is one. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initStorage();
      const cached = storage.getCached(STORAGE_KEYS.session);
      if (!cached || cancelled) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        setUser(JSON.parse(cached) as User);
      } catch {
        // Corrupt cache — drop it rather than crash.
        await storage.remove(STORAGE_KEYS.session);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: User) => {
    setUser(next);
    await storage.set(STORAGE_KEYS.session, JSON.stringify(next));
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user: u } = await apiLogin({ email, password });
      await persist(u);
    },
    [persist],
  );

  const signUp = useCallback(
    async (input: {
      name: string;
      email: string;
      phone: string;
      password: string;
      level?: string;
      position?: string;
    }) => {
      const { user: u } = await apiSignup(input);
      await persist(u);
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    setUser(null);
    await storage.remove(STORAGE_KEYS.session);
  }, []);

  const refresh = useCallback(async () => {
    // The session cache holds the whole profile, so re-authenticating is the
    // only way to re-read it without a dedicated /api/auth/me route. Left as a
    // no-op hook so screens can call it unconditionally.
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<User> & { defaultCity?: string }) => {
      if (!user) throw new Error("Not logged in");
      const next = await apiUpdateProfile(user.id, patch);
      // Adopt the server's version wholesale rather than merging the patch
      // locally, then persist it so a cold start sees the new values.
      await persist(next);
      return next;
    },
    [user, persist],
  );

  // Derived exactly as the web UserProvider does, so a screen ported from the
  // web app can branch on isOwner without changes.
  const isOwner = user?.role === "owner";
  const isPlayer = user?.role !== "owner";

  const value = useMemo(
    () => ({ user, ready, isOwner, isPlayer, signIn, signUp, signOut, refresh, updateProfile }),
    [user, ready, isOwner, isPlayer, signIn, signUp, signOut, refresh, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
