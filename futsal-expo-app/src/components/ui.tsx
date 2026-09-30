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
      <Label>{label}</Label>
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
            minHeight: multiline ? 88 : CONTROL_HEIGHT,
          },
        ]}
      />
      {error ? <Text style={[styles.errorText, { color: colors.dangerText }]}>{error}</Text> : null}
    </View>
  );
}

/* ── Labels and controls ─────────────────────────────────────────────────── */

/**
 * Height every text control in the app shares.
 *
 * Inputs, password boxes and picker rows are built by different components, and
 * when their paddings or heights disagree the form looks broken even though each
 * piece is fine on its own. They all read this number instead.
 */
export const CONTROL_HEIGHT = 48;

/** The uppercase field label used by every form, auth screens included. */
export function Label({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return <Text style={[styles.fieldLabel, { color: colors.textMuted }, style]}>{children}</Text>;
}

/**
 * A single-line text control with an optional leading icon and trailing slot
 * (the show/hide eye, a unit, a spinner).
 *
 * Same height, padding, radius and type size as `Field`, which is the whole
 * point: Login, Signup and Forgot password mix these freely and the columns
 * still line up.
 */
export function TextControl({
  value,
  onChangeText,
  placeholder,
  icon,
  right,
  error = false,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "none",
  autoComplete,
  textContentType,
  maxLength,
  returnKeyType,
  onSubmitEditing,
  accessibilityLabel,
  autoFocus = false,
  editable = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  error?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "email" | "password" | "tel" | "name" | "one-time-code" | "off";
  textContentType?: "emailAddress" | "password" | "newPassword" | "telephoneNumber" | "name" | "oneTimeCode";
  maxLength?: number;
  returnKeyType?: "done" | "next" | "go" | "search" | "send";
  onSubmitEditing?: () => void;
  accessibilityLabel?: string;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.control,
        {
          backgroundColor: colors.inset,
          borderColor: error ? colors.dangerText : colors.border,
          opacity: editable ? 1 : 0.6,
        },
      ]}
    >
      {icon}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        autoCorrect={false}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        editable={editable}
        autoFocus={autoFocus}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={[styles.controlInput, { color: colors.text }]}
      />
      {right}
    </View>
  );
}

/**
 * A themed switch.
 *
 * React Native's `Switch` is the platform control — on iOS it is a UISwitch, on
 * web a browser checkbox — so it never matches either palette. This is two views
 * and a translate, which does.
 */
export function Toggle({
  label,
  sub,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.toggleRow, { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      <View style={styles.grow}>
        <Text style={[styles.toggleLabel, { color: c.text }]}>{label}</Text>
        {sub ? <Text style={[styles.toggleSub, { color: c.textMuted }]}>{sub}</Text> : null}
      </View>
      <View
        style={[
          styles.track,
          {
            backgroundColor: value ? c.primary : c.inset,
            borderColor: value ? c.primary : c.border,
          },
        ]}
      >
        <View
          style={[
            styles.knob,
            {
              backgroundColor: value ? c.primaryText : c.textFaint,
              transform: [{ translateX: value ? 18 : 0 }],
            },
          ]}
        />
      </View>
    </Pressable>
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
  fieldLabel: {
    fontSize: fontSize.sm,
    marginBottom: space["1"],
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  control: {
    minHeight: CONTROL_HEIGHT,
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: space["3.5"],
    flexDirection: "row",
    alignItems: "center",
    gap: space["2"],
  },
  controlInput: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.lg,
    fontWeight: "600",
    paddingVertical: space["2"],
  },
  grow: { flex: 1, minWidth: 0 },
  toggleRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space["3"],
    paddingVertical: space["2"],
  },
  toggleLabel: { fontSize: fontSize.base, fontWeight: "800" },
  toggleSub: { marginTop: 2, fontSize: fontSize.xs, lineHeight: 16 },
  track: {
    width: 44,
    height: 26,
    borderWidth: 1,
    borderRadius: radius.full,
    padding: 2,
    justifyContent: "center",
  },
  knob: { width: 20, height: 20, borderRadius: radius.full },
  input: {
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: space["3.5"],
    paddingVertical: space["2"],
    fontSize: fontSize.lg,
    fontWeight: "600",
    minHeight: CONTROL_HEIGHT,
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
