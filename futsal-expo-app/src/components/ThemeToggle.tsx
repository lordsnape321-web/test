import { Moon, Sun } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { colors as brand, radius } from "@/theme";

/** Theme toggle — same 40×40 rounded-xl control as the web ThemeToggle. */
export function ThemeToggle({ style }: { style?: object }) {
  const { isDark, setMode, mode } = useTheme();
  const next = isDark ? "light" : "dark";
  return (
    <Pressable
      onPress={() => setMode(next as "light" | "dark")}
      accessibilityRole="button"
      accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={[
        styles.btn,
        isDark
          ? {
              borderColor: "rgba(255,255,255,0.10)",
              backgroundColor: brand.stone900,
            }
          : {
              borderColor: brand.stone200,
              backgroundColor: brand.white,
            },
        style,
      ]}
    >
      {isDark ? (
        <Sun size={20} color={brand.amber300} />
      ) : (
        <Moon size={20} color={brand.stone600} />
      )}
      {mode === "system" ? null : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
});
