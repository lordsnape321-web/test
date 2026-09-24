import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, useColorScheme } from "react-native";
import { darkPalette, lightPalette, ownerPalette, type Palette } from "@/theme";
import { STORAGE_KEYS, initStorage, storage } from "@/lib/storage";

/**
 * Light/dark switching — mirrors the web ThemeProvider (`light` | `dark`),
 * which reads `localStorage['futsal-theme']` and toggles a `dark` class.
 *
 * The first render is light, like the web app. After hydration, an explicit
 * saved mode wins; otherwise the device colour scheme is used once as the
 * initial mode. The toggle always writes an explicit light/dark value.
 *
 * Owner Studio (/admin) forces `ownerPalette` (light slate workspace).
 */

export type ThemeMode = "light" | "dark" | "system";

type ThemeState = {
  mode: ThemeMode;
  /** The palette to actually use, with system already resolved. */
  colors: Palette;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  /** Flip light ↔ dark (what the navbar control does). */
  toggle: () => void;
  studio: boolean;
  setStudio: (on: boolean) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [studio, setStudio] = useState(false);
  const hydrated = useRef(false);
  // Bumped on every setMode so consumers re-read even if isDark was already true.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initStorage();
      if (cancelled || hydrated.current) return;
      const stored = storage.getCached(STORAGE_KEYS.theme);
      if (stored === "light" || stored === "dark" || stored === "system") {
        setModeState(stored);
      } else if (system === "dark") {
        setModeState("dark");
      }
      hydrated.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [system]);

  const setMode = useCallback((next: ThemeMode) => {
    hydrated.current = true;
    setModeState(next);
    setNonce((n) => n + 1);
    void storage.set(STORAGE_KEYS.theme, next);
  }, []);

  const toggle = useCallback(() => {
    hydrated.current = true;
    setModeState((prev) => {
      const currentlyDark = prev === "dark" || (prev === "system" && system === "dark");
      const next: ThemeMode = currentlyDark ? "light" : "dark";
      void storage.set(STORAGE_KEYS.theme, next);
      return next;
    });
    setNonce((n) => n + 1);
  }, [system]);

  const systemDark = mode === "system" ? system === "dark" : mode === "dark";
  // Studio is always the light slate workspace, matching OwnerShell on the web.
  const isDark = studio ? false : systemDark;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);

  const value = useMemo(
    () => ({
      mode,
      colors: studio ? ownerPalette : isDark ? darkPalette : lightPalette,
      isDark,
      setMode,
      toggle,
      studio,
      setStudio,
      // expose so memo identity changes even when isDark is unchanged
      nonce,
    }),
    [mode, isDark, setMode, toggle, studio, nonce],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
