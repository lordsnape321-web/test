import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, ownerPalette, type Palette } from "@/theme";
import { STORAGE_KEYS, initStorage, storage } from "@/lib/storage";

/**
 * Light/dark switching.
 *
 * The web app applies a `dark` class to <html> from an inline script. React
 * Native has no DOM, so the palette is provided through context instead and
 * every component reads colours from `useTheme()`.
 *
 * Three states: "light", "dark", and "system" (follow the device). "system" is
 * the default, which is what the web app does when nothing is stored.
 *
 * Owner Studio (/admin/*) is a light slate workspace on the web, unlike the
 * warm player app — force `ownerPalette` while `studio` is true so admin
 * screens never inherit the peach clubhouse look (or dark player colours).
 */

export type ThemeMode = "light" | "dark" | "system";

type ThemeState = {
  mode: ThemeMode;
  /** The palette to actually use, with system already resolved. */
  colors: Palette;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  /**
   * Enter/leave Owner Studio chrome. The web routes pick the palette by
   * path (`/admin/*` → OwnerShell); React Native stacks have no shared path
   * context, so the admin layout flips this flag.
   */
  studio: boolean;
  setStudio: (on: boolean) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [studio, setStudio] = useState(false);

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
    void storage.set(STORAGE_KEYS.theme, next);
  }, []);

  const systemDark = mode === "system" ? system === "dark" : mode === "dark";
  // Studio is always the light slate workspace, matching OwnerShell on the web.
  const isDark = studio ? false : systemDark;

  const value = useMemo(
    () => ({
      mode,
      colors: studio ? ownerPalette : isDark ? darkPalette : lightPalette,
      isDark,
      setMode,
      studio,
      setStudio,
    }),
    [mode, isDark, setMode, studio],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
