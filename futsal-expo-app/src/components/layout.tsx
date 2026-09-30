import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useBreakpoints } from "@/lib/responsive";
import { space } from "@/theme";

/**
 * Page column — applies the responsive page gutters (`px-4 sm:px-6 xl:px-8`)
 * and lets the content use the full window. There is deliberately no max-width:
 * on a desktop browser the app fills the window, and the grids inside add
 * columns as it gets wider instead of leaving empty margins.
 */
export function PageContainer({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Apply horizontal gutters (default true — matches `px-4 sm:px-6`). */
  padded?: boolean;
}) {
  const bp = useBreakpoints();
  return (
    <View
      style={[
        styles.base,
        {
          paddingHorizontal: padded ? bp.gutter : 0,
          width: "100%",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Responsive card grid. `columns` defaults to the breakpoint's card count
 * (1 / 2 / 3 like `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`).
 *
 * Gaps are applied as negative-margin + half-gutter padding on each cell so
 * percentage widths never overflow the row (React Native has no `calc()`).
 */
export function ResponsiveGrid({
  children,
  columns,
  gap = space[4],
  style,
}: {
  children: React.ReactNode;
  columns?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const bp = useBreakpoints();
  const cols = Math.max(1, columns ?? bp.cardColumns);
  const items = React.Children.toArray(children);
  const half = gap / 2;

  return (
    <View
      style={[
        styles.grid,
        { marginHorizontal: -half, marginBottom: -gap },
        style,
      ]}
    >
      {items.map((child, i) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          style={{
            width: `${100 / cols}%`,
            paddingHorizontal: half,
            paddingBottom: gap,
            minWidth: 0,
          }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: "center",
    minWidth: 0,
    flexShrink: 1,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
  },
});
