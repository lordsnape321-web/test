import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/context/ThemeContext";

/**
 * Shared canvas for the native and Expo web shells. Keeping this as one flat,
 * palette-owned surface prevents a screen from briefly flashing browser white
 * when a route or the Owner Studio palette is changing.
 */
export function TurfBackdrop({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors: c } = useTheme();

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }, style]}
    />
  );
}
