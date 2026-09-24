/**
 * Design tokens for the native app.
 *
 * Every value here is transcribed from the Next.js app's src/app/globals.css and
 * the component class strings, not invented. React Native has no Tailwind, so
 * the design system lives here as plain constants that screens compose.
 *
 * The web app has two distinct looks and both are represented:
 *   - Player app: warm peach (#FFF9F0) light / slate-950 dark, stone text,
 *     emerald + orange accents. This is the "clubhouse" look.
 *   - Owner Studio (/admin/*): a light slate workspace. Ported separately.
 *
 * Light mode is NOT a neutral grey — it is deliberately warm. Getting this wrong
 * makes every screen look like a different app, which is why the earlier draft
 * of this file (slate-50 background) had to be rewritten.
 */

export const colors = {
  /* ── Brand accents ─────────────────────────────────────────────────── */
  emerald50: "#ECFDF5",
  emerald100: "#D1FAE5",
  emerald300: "#6EE7B7",
  emerald400: "#34D399",
  emerald500: "#10B981",
  emerald600: "#059669", // primary action colour, and ::selection
  emerald700: "#047857",
  green700: "#15803D",

  orange50: "#FFF7ED",
  orange100: "#FFEDD5",
  orange300: "#FDBA74",
  orange400: "#FB923C",
  orange500: "#F97316", // secondary accent: Owner Studio, "Featured"
  orange600: "#EA580C",
  orange700: "#C2410C",

  amber300: "#FCD34D",
  amber400: "#FBBF24",

  /* ── Feedback ──────────────────────────────────────────────────────── */
  red50: "#FEF2F2",
  red100: "#FEE2E2",
  red200: "#FECACA",
  red400: "#F87171",
  red500: "#EF4444",
  red600: "#DC2626",

  sky100: "#E0F2FE",
  sky300: "#7DD3FC",
  sky500: "#0EA5E9",
  sky700: "#0369A1",

  violet300: "#C4B5FD",
  violet500: "#8B5CF6",
  violet700: "#6D28D9",

  /* ── Stone ramp: the player app's light-mode neutrals ──────────────── */
  stone50: "#FAFAF9",
  stone100: "#F5F5F4",
  stone200: "#E7E5E4",
  stone300: "#D6D3D1",
  stone400: "#A8A29E",
  stone500: "#78716C",
  stone600: "#57534E",
  stone700: "#44403C",
  stone800: "#292524",
  stone900: "#1C1917", // body text in light mode

  /* ── Slate ramp: dark mode + Owner Studio neutrals ─────────────────── */
  slate100: "#F1F5F9", // body text in dark mode
  slate200: "#E2E8F0",
  slate300: "#CBD5E1",
  slate400: "#94A3B8",
  slate500: "#64748B",
  slate600: "#475569",
  slate700: "#334155",
  slate800: "#1E293B",
  slate900: "#0F172A", // dark card surface
  slate950: "#020617", // dark body background

  white: "#FFFFFF",

  /* ── The warm clubhouse palette (globals.css) ──────────────────────── */
  peach: "#FFF9F0", // body background, light mode
  headerCream: "#FFFDF7", // navbar background, light mode
  borderSand: "#F0E3CC", // card + nav borders, light mode
  insetCream: "#FFF6E9", // small stat tiles inside cards
} as const;

export type Palette = {
  /** Page background. */
  bg: string;
  /** Elevated surface: cards, sheets, header. */
  surface: string;
  /** Recessed surface: small stat tiles, input fills. */
  inset: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Primary action. */
  primary: string;
  primaryText: string;
  /** Secondary / owner accent. */
  accent: string;
  accentText: string;
  /** Active tab tint. */
  activeSoft: string;
  activeText: string;
  shadow: string;
};

/**
 * Player app, light mode: the warm clubhouse look.
 * body #FFF9F0 / text #1C1917, cards white on #F0E3CC borders.
 *
 * `bg` is transparent so the shell's TurfBackdrop (the `.turf-pattern`
 * equivalent) paints through every screen; the pattern itself includes the
 * peach base colour.
 */
export const lightPalette: Palette = {
  bg: "transparent",
  surface: colors.white,
  inset: colors.insetCream,
  border: colors.borderSand,
  text: colors.stone900,
  textMuted: colors.stone500,
  textFaint: colors.stone400,
  primary: colors.emerald600,
  primaryText: colors.white,
  accent: colors.orange500,
  accentText: colors.white,
  activeSoft: colors.emerald100,
  activeText: colors.emerald700,
  shadow: "rgba(180,120,60,0.10)",
};

/**
 * Player app, dark mode.
 * body #020617 / text #F1F5F9, cards slate-900 on white/10 borders.
 * `bg` is transparent for the same reason as light mode.
 */
export const darkPalette: Palette = {
  bg: "transparent",
  surface: colors.slate900,
  inset: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.10)",
  text: colors.slate100,
  textMuted: colors.slate400,
  textFaint: colors.slate500,
  primary: colors.emerald500,
  primaryText: colors.slate950,
  accent: colors.orange500,
  accentText: colors.white,
  activeSoft: "rgba(16,185,129,0.15)",
  activeText: colors.emerald400,
  shadow: "rgba(0,0,0,0.55)",
};

/**
 * Owner Studio (/admin/*) is a light slate workspace, deliberately unlike the
 * warm player app. Only a light variant exists — the web app does not theme it
 * dark beyond a few overrides.
 */
export const ownerPalette: Palette = {
  bg: colors.slate100,
  surface: colors.white,
  inset: colors.slate100,
  border: colors.slate200,
  text: colors.slate900,
  textMuted: colors.slate500,
  textFaint: colors.slate400,
  primary: colors.orange500,
  primaryText: colors.white,
  accent: colors.emerald600,
  accentText: colors.white,
  activeSoft: colors.orange100,
  activeText: colors.orange700,
  shadow: "rgba(15,23,42,0.08)",
};

/**
 * Spacing on a 4px grid — Tailwind's scale, which the web app is built on
 * (1 unit = 0.25rem = 4px). Names match the Tailwind steps so a class string
 * translates mechanically: p-4 -> space[4] -> 16.
 */
export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

/** Tailwind's border-radius scale, likewise 1:1 with the class names. */
export const radius = {
  none: 0,
  sm: 2,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24, // the card radius used throughout the player app
  full: 999,
} as const;

/**
 * Type scale. The web app leans on arbitrary values (text-[15px], text-[11px])
 * for density, so the common ones are named rather than rounded away.
 */
export const fontSize = {
  "2xs": 10, // text-[10px] — uppercase micro-labels
  xs: 11, // text-[11px]
  sm: 12, // text-xs
  base: 14, // text-sm — the workhorse size
  md: 15, // text-[15px] — card titles
  lg: 16,
  xl: 18, // text-lg
  "2xl": 20,
  "3xl": 24,
  "4xl": 30,
  "5xl": 36,
} as const;

/** Tailwind font-weight names, since the design uses them semantically. */
export const fontWeight = {
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  black: "900",
} as const;

/**
 * Minimum tap target: 44pt (Apple's guideline; Android's 48dp is close enough
 * that one value serves both). The web app enforces the same floor via
 * min-h-11/min-w-11.
 */
export const MIN_TAP_TARGET = 44;

/** The web app's font stack. Plus Jakarta Sans is loaded in the root layout. */
export const APP_FONT_FAMILY = "PlusJakartaSans_400Regular";
export const fontFamily = {
  sans: "PlusJakartaSans_400Regular",
} as const;
