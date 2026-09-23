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
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
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
          ? colors.surfaceAlt
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
        <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
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
            backgroundColor: colors.surface,
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
        { backgroundColor: colors.card, borderColor: colors.border },
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
  const { colors } = useTheme();
  const map: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
    success: { bg: "#D1FAE5", fg: "#047857" },
    warning: { bg: "#FEF3C7", fg: "#B45309" },
    danger: { bg: "#FEE2E2", fg: "#B91C1C" },
    info: { bg: "#DBEAFE", fg: "#1D4ED8" },
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
  const { colors } = useTheme();
  const bg = tone === "error" ? "#FEE2E2" : tone === "success" ? "#D1FAE5" : "#DBEAFE";
  const fg = tone === "error" ? "#B91C1C" : tone === "success" ? "#047857" : "#1D4ED8";
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: bg, borderColor: colors.border }]}
    >
      <Text style={{ color: fg, fontSize: fontSize.sm }}>{message}</Text>
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
        <Text style={[styles.muted, { color: colors.textMuted, marginTop: space.md }]}>
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
      <Text style={{ color: colors.textMuted, fontSize: fontSize.base }}>{message}</Text>
    </View>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  button: {
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  buttonLabel: { fontSize: fontSize.base, fontWeight: "600" },
  field: { marginBottom: space.lg },
  label: { fontSize: fontSize.sm, marginBottom: space.xs, fontWeight: "500" },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: fontSize.base,
  },
  errorText: { color: "#B91C1C", fontSize: fontSize.xs, marginTop: space.xs },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  pill: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  pillLabel: { fontSize: fontSize.xs, fontWeight: "600" },
  notice: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.lg,
  },
  center: { alignItems: "center", justifyContent: "center", padding: space.xxl },
  muted: { fontSize: fontSize.sm },
});
