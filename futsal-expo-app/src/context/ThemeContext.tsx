import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, ownerPalette, type Palette } from "@/theme";
import { STORAGE_KEYS, initStorage, storage } from "@/lib/storage";

/**
 * Light/dark switching — mirrors the web ThemeProvider (`light` | `dark`),
 * which reads `localStorage['futsal-theme']` and toggles a `dark` class.
 *
 * Expo keeps a third `system` mode as the first-run default (same as the web
 * script when nothing is stored), but the ThemeToggle always flips between
 * explicit light and dark so one tap always changes what you see.
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
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [studio, setStudio] = useState(false);
  // Bumped on every setMode so consumers re-read even if isDark was already true
  // (e.g. system→dark while device is dark) — rare but keeps optimistic UI honest.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    (async () => {
      await initStorage();
      const stored = storage.getCached(STORAGE_KEYS.theme);
      if (stored === "light" || stored === "dark" || stored === "system") {
        setModeState(stored);
      }
    })();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    setNonce((n) => n + 1);
    void storage.set(STORAGE_KEYS.theme, next);
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const currentlyDark =
        prev === "system" ? system === "dark" : prev === "dark";
      const next: ThemeMode = currentlyDark ? "light" : "dark";
      void storage.set(STORAGE_KEYS.theme, next);
      return next;
    });
    setNonce((n) => n + 1);
  }, [system]);

  const systemDark = mode === "system" ? system === "dark" : mode === "dark";
  // Studio is always the light slate workspace, matching OwnerShell on the web.
  const isDark = studio ? false : systemDark;

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
