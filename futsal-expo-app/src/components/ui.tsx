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
        ? colors.dangerText
        : variant === "secondary"
          ? colors.inset
          : "transparent";

  const fg =
    variant === "primary"
      ? colors.primaryText
      : variant === "danger"
        ? colors.primaryText
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
          multiline ? styles.multilineInput : null,
          {
            backgroundColor: colors.inset,
            borderColor: error ? colors.dangerText : colors.border,
            color: colors.text,
            minHeight: multiline ? 88 : MIN_TAP_TARGET,
          },
        ]}
      />
      {error ? <Text style={[styles.errorText, { color: colors.dangerText }]}>{error}</Text> : null}
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
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.shadow,
        },
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
  // Soft chips are palette-owned so the same semantic tone has enough contrast
  // in player light/dark mode and in the separate Owner Studio palette.
  const map: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: colors.inset, fg: colors.textMuted },
    success: { bg: colors.successBg, fg: colors.successText },
    warning: { bg: colors.warningBg, fg: colors.warningText },
    danger: { bg: colors.dangerBg, fg: colors.dangerText },
    info: { bg: colors.infoBg, fg: colors.infoText },
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
  const feedback =
    tone === "error"
      ? { bg: colors.dangerBg, fg: colors.dangerText, border: colors.dangerBorder }
      : tone === "success"
        ? { bg: colors.successBg, fg: colors.successText, border: colors.successBorder }
        : { bg: colors.infoBg, fg: colors.infoText, border: colors.infoBorder };
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: feedback.bg, borderColor: feedback.border }]}
    >
      <Text style={{ color: feedback.fg, fontSize: fontSize.base }}>{message}</Text>
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
  multilineInput: {
    textAlignVertical: "top",
    paddingTop: space["3"],
  },
  errorText: { fontSize: fontSize.sm, marginTop: space["1"] },
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
