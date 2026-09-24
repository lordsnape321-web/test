import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

/**
 * Solid player backdrop shared by native and Expo web.
 *
 * Keeping this as one flat colour is intentional: the player shell should be
 * navy in dark mode and white in light mode on every platform. Individual
 * cards and the hero image still carry their own surfaces, but the page itself
 * must not change colour because an SVG/CSS gradient rendered differently on
 * web and native.
 */
export function TurfBackdrop({ style }: { style?: object }) {
  const { isDark, studio } = useTheme();

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: studio ? "#F1F5F9" : isDark ? "#020617" : "#FFFFFF",
        },
        style,
      ]}
    />
  );
}
