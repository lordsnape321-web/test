import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { MIN_TAP_TARGET, fontSize, radius, space } from "@/theme";

/**
 * The handful of primitives every screen in the slice needs.
 *
 * Deliberately small: Button, Field, Card, Pill, Notice, Spinner. Anything more
 * elaborate belongs in its own component rather than growing this file.
 */

/* ── Button ──────────────────────────────────────────────────────────────── */

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const bg =
    variant === "primary"
      ? colors.primary
      : variant === "danger"
        ? "#EF4444"
        : variant === "secondary"
          ? colors.inset
          : "transparent";

  const fg =
    variant === "primary"
      ? colors.primaryText
      : variant === "danger"
        ? "#FFFFFF"
        : colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === "ghost" ? colors.border : "transparent",
          borderWidth: variant === "ghost" ? 1 : 0,
          opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={styles.buttonContent}>
          {icon}
          <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/* ── Field ───────────────────────────────────────────────────────────────── */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  editable = true,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string | null;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  editable?: boolean;
  multiline?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        multiline={multiline}
        accessibilityLabel={label}
        style={[
          styles.input,
          {
            backgroundColor: colors.inset,
            borderColor: error ? "#EF4444" : colors.border,
            color: colors.text,
            minHeight: multiline ? 88 : MIN_TAP_TARGET,
          },
        ]}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────── */

export function Card({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const inner = (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
    >
      {inner}
    </Pressable>
  );
}

/* ── Pill ────────────────────────────────────────────────────────────────── */

export function Pill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand";
}) {
  const { colors, isDark } = useTheme();
  // Soft chips match the web's dark: variants (e.g. dark:bg-emerald-500/15).
  const map: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: colors.inset, fg: colors.textMuted },
    success: isDark
      ? { bg: "rgba(16,185,129,0.15)", fg: "#34D399" }
      : { bg: "#D1FAE5", fg: "#047857" },
    warning: isDark
      ? { bg: "rgba(245,158,11,0.15)", fg: "#FCD34D" }
      : { bg: "#FEF3C7", fg: "#B45309" },
    danger: isDark
      ? { bg: "rgba(239,68,68,0.15)", fg: "#F87171" }
      : { bg: "#FEE2E2", fg: "#B91C1C" },
    info: isDark
      ? { bg: "rgba(59,130,246,0.15)", fg: "#7DD3FC" }
      : { bg: "#DBEAFE", fg: "#1D4ED8" },
    brand: { bg: colors.primary, fg: colors.primaryText },
  };
  const c = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillLabel, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/* ── Notice ──────────────────────────────────────────────────────────────── */

export function Notice({
  message,
  tone = "error",
}: {
  message: string;
  tone?: "error" | "info" | "success";
}) {
  const { colors, isDark } = useTheme();
  const soft = tone === "error" ? "rgba(239,68,68,0.12)" : tone === "success" ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.12)";
  const softFg = tone === "error" ? "#F87171" : tone === "success" ? "#34D399" : "#7DD3FC";
  const solidBg = tone === "error" ? "#FEE2E2" : tone === "success" ? "#D1FAE5" : "#DBEAFE";
  const solidFg = tone === "error" ? "#B91C1C" : tone === "success" ? "#047857" : "#1D4ED8";
  const bg = isDark ? soft : solidBg;
  const fg = isDark ? softFg : solidFg;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: bg, borderColor: colors.border }]}
    >
      <Text style={{ color: fg, fontSize: fontSize.base }}>{message}</Text>
    </View>
  );
}

/* ── Spinner / Empty ─────────────────────────────────────────────────────── */

export function Spinner({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? (
        <Text style={[styles.muted, { color: colors.textMuted, marginTop: space["3"] }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function Empty({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.lg }}>{message}</Text>
    </View>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  button: {
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
    // Most primary CTAs on the web are rounded-full font-black; secondary
    // buttons are rounded-xl. Primary keeps xl to match the shared Button;
    // call sites that need full-round pass `style`.
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space["4"],
    paddingVertical: space["3"],
  },
  buttonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2] },
  buttonLabel: { fontSize: fontSize.base, fontWeight: "800" },
  field: { marginBottom: 0 },
  label: {
    fontSize: fontSize.sm,
    marginBottom: space["1"],
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: space["3.5"],
    paddingVertical: space["2.5"],
    fontSize: fontSize.lg,
    minHeight: MIN_TAP_TARGET,
  },
  errorText: { color: "#B91C1C", fontSize: fontSize.sm, marginTop: space["1"] },
  card: {
    borderWidth: 1,
    // rounded-3xl border border-[#F0E3CC] bg-white shadow — player app cards
    borderRadius: radius["3xl"],
    padding: space["4"],
    marginBottom: space["3"],
    // shadow-[0_10px_30px_rgba(180,120,60,0.08)]
    shadowColor: "rgb(180,120,60)",
    shadowOpacity: 0.08,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  pill: {
    paddingHorizontal: space["2"] + 2,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: "flex-start",
  },
  pillLabel: { fontSize: fontSize.sm, fontWeight: "600" },
  notice: {
    borderWidth: 1,
    borderRadius: radius["2xl"],
    padding: space["3"],
    marginBottom: space["4"],
  },
  center: { alignItems: "center", justifyContent: "center", padding: space["8"] },
  muted: { fontSize: fontSize.base },
});
