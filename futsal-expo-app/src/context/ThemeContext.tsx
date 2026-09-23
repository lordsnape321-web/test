import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, type Palette } from "@/theme";
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
 */

export type ThemeMode = "light" | "dark" | "system";

type ThemeState = {
  mode: ThemeMode;
  /** The palette to actually use, with system already resolved. */
  colors: Palette;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

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

  const isDark = mode === "system" ? system === "dark" : mode === "dark";

  const value = useMemo(
    () => ({ mode, colors: isDark ? darkPalette : lightPalette, isDark, setMode }),
    [mode, isDark, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
