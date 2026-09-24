import { useWindowDimensions } from "react-native";

/**
 * Tailwind's default breakpoints, so call sites can translate `sm:` / `md:` /
 * `lg:` classes 1:1. Widths are inclusive lower bounds (min-width in CSS).
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

export type Breakpoints = {
  width: number;
  height: number;
  /** ≥640 — Tailwind `sm` */
  sm: boolean;
  /** ≥768 — Tailwind `md` */
  md: boolean;
  /** ≥1024 — Tailwind `lg` (desktop nav, multi-column content) */
  lg: boolean;
  /** ≥1280 — Tailwind `xl` */
  xl: boolean;
  /**
   * Content column width matching the web's `max-w-7xl` (80rem = 1280px),
   * centred. Below that it is just the viewport minus page gutters.
   */
  contentMax: number;
  /** Horizontal page gutter: `px-4 sm:px-6` */
  gutter: number;
  /**
   * How many equal columns a card grid should use at this width —
   * mirrors `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (and 4-col stats).
   */
  cardColumns: number;
  statColumns: number;
};

export function useBreakpoints(): Breakpoints {
  const { width, height } = useWindowDimensions();
  const sm = width >= breakpoints.sm;
  const md = width >= breakpoints.md;
  const lg = width >= breakpoints.lg;
  const xl = width >= breakpoints.xl;

  return {
    width,
    height,
    sm,
    md,
    lg,
    xl,
    contentMax: 1280,
    gutter: sm ? 24 : 16,
    cardColumns: lg ? 3 : sm ? 2 : 1,
    statColumns: sm ? 4 : 2,
  };
}

/**
 * Inline style for a multi-column flex/grid wrap that tracks breakpoints:
 * each child gets `flexBasis` so N columns fit per row with the given gap.
 */
export function columnStyle(
  columns: number,
  gap: number,
): { flexDirection: "row"; flexWrap: "wrap"; gap: number } {
  return { flexDirection: "row", flexWrap: "wrap", gap };
}

/** Child width percentage for `columns` equal columns with `gap` between. */
export function columnItemBasis(columns: number, gap: number): string | number {
  if (columns <= 1) return "100%";
  // gap is in px; subtract (columns-1)*gap from 100% via calc-equivalent.
  // RN supports percentage width; gap already reserved by flex gap.
  const gapPct = ((columns - 1) * gap) / 10; // rough — callers pass gap in px
  const basis = (100 - (columns > 0 ? ((columns - 1) * gap * 100) / 1000 : 0)) / columns;
  void gapPct;
  return `${basis}%`;
}
