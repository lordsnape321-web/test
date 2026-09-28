import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS, initStorage, storage } from "@/lib/storage";

/**
 * Device preferences that belong to the phone, not to an account.
 *
 * Theme lives in its own context because it owns the whole palette. This one
 * owns the small switches that have no business in a user profile: right now
 * that is *browse mode*, the signed-out mode.
 *
 * Browse mode exists because a signed-out player is not always someone who
 * needs persuading. Somebody checking whether their ground has a court at 6am
 * has made a choice already, and a full-width "Log in / Join free" panel in
 * their face every time they open Bookings is nagging, not welcoming. With
 * browse mode on, the sign-in prompts step back to quiet outlines and say what
 * they are instead of shouting over the thing you came to look at.
 *
 * It is deliberately local and non-destructive. Nothing about the account
 * changes, and switching it off puts the original call to action straight back.
 */

type PrefsState = {
  /** True once storage has been read, so the UI can avoid a flash of default. */
  ready: boolean;
  /** Signed-out browsing: quiet sign-in prompts, nothing else changes. */
  browseMode: boolean;
  setBrowseMode: (on: boolean) => void;
  /** Flip it, for a one-tap control outside Settings. */
  toggleBrowseMode: () => void;
};

const PrefsContext = createContext<PrefsState | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [browseMode, setBrowseModeState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await initStorage();
      if (cancelled) return;
      setBrowseModeState(storage.getCached(STORAGE_KEYS.browseMode) === "on");
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setBrowseMode = useCallback((on: boolean) => {
    setBrowseModeState(on);
    void storage.set(STORAGE_KEYS.browseMode, on ? "on" : "off");
  }, []);

  const toggleBrowseMode = useCallback(() => {
    setBrowseModeState((prev) => {
      void storage.set(STORAGE_KEYS.browseMode, prev ? "off" : "on");
      return !prev;
    });
  }, []);

  const value = useMemo(
    () => ({ ready, browseMode, setBrowseMode, toggleBrowseMode }),
    [ready, browseMode, setBrowseMode, toggleBrowseMode],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsState {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return ctx;
}
