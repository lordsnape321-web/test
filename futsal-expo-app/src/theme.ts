/**
 * Design tokens for the native app.
 *
 * React Native has no Tailwind, so the palette lives here as plain constants.
 * The values are Tailwind's own emerald/slate ramps, which is what the web app
 * uses throughout — verified by counting class usage across src/components and
 * src/app, where emerald is the accent (bg-emerald-500 ×111, bg-emerald-600 ×109)
 * and slate the neutral scale (text-slate-500 ×326).
 *
 * Keeping both light and dark here matters: the web app carries a full dark
 * theme, and RN needs the equivalent expressed as a switchable palette object
 * rather than `dark:` variants.
 */

export const colors = {
  /** Brand accent. */
  primary: "#10B981", // emerald-500
  primaryDark: "#059669", // emerald-600
  primaryDeep: "#047857", // emerald-700
  primarySoft: "#D1FAE5", // emerald-100

  /** Feedback. */
  danger: "#EF4444", // red-500
  warning: "#F59E0B", // amber-500
  info: "#3B82F6", // blue-500
  purple: "#8B5CF6", // violet-500

  /** Slate ramp. */
  slate50: "#F8FAFC",
  slate100: "#F1F5F9",
  slate200: "#E2E8F0",
  slate300: "#CBD5E1",
  slate400: "#94A3B8",
  slate500: "#64748B",
  slate600: "#475569",
  slate700: "#334155",
  slate800: "#1E293B",
  slate900: "#0F172A",
  slate950: "#020617",

  white: "#FFFFFF",
  /** The web app's light-mode page tint. */
  cream: "#FFF9F0",
} as const;

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryText: string;
  card: string;
};

export const lightPalette: Palette = {
  bg: colors.slate50,
  surface: colors.white,
  surfaceAlt: colors.slate100,
  border: colors.slate200,
  text: colors.slate900,
  textMuted: colors.slate500,
  textFaint: colors.slate400,
  primary: colors.primary,
  primaryText: colors.white,
  card: colors.white,
};

export const darkPalette: Palette = {
  bg: colors.slate950, // matches .dark body #020617
  surface: colors.slate900,
  surfaceAlt: colors.slate800,
  border: colors.slate700,
  text: colors.slate100,
  textMuted: colors.slate400,
  textFaint: colors.slate500,
  primary: colors.primary,
  primaryText: colors.slate950,
  card: colors.slate900,
};

/**
 * Spacing on a 4px grid, matching the Tailwind scale the web app is built on
 * (Tailwind's default step is 0.25rem = 4px).
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
} as const;

/**
 * Minimum tap target. 44pt is Apple's guideline and Android's 48dp is close
 * enough that one value serves both; the web app enforces the same floor
 * (min-h-11/min-w-11 = 44px).
 */
export const MIN_TAP_TARGET = 44;
