import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, Notice } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import {
  firstError,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} from "@/lib/validation";
import { fontSize, radius, space } from "@/theme";

/**
 * Create a player account.
 *
 * Every rule is the ported validator from src/lib/validation.ts — the same file
 * the Next.js signup route calls. The API's own LEVELS and POSITIONS lists are
 * mirrored below; they must stay in sync with src/app/api/auth/signup/route.ts,
 * which rejects anything outside them with a 400.
 */

const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
const POSITIONS = [
  "Striker",
  "Midfielder",
  "Winger",
  "Defender",
  "Goalkeeper",
  "Pivot",
  "All-rounder",
] as const;

export default function Signup() {
  const { colors } = useTheme();
  const { signUp } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState<string>("Intermediate");
  const [position, setPosition] = useState<string>("All-rounder");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = validateName(name);
  const emailError = validateEmail(email);
  const phoneError = validatePhone(phone, { required: true });
  const passwordError = validatePassword(password);

  async function submit() {
    setTouched(true);
    setError(null);

    const invalid = firstError(nameError, emailError, phoneError, passwordError);
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    try {
      await signUp({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        level,
        position,
      });
      router.replace("/(app)");
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not create your account. Try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: colors.text }]}>Create your player account</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Your trust score starts at 100. Book and turn up to keep it there.
          </Text>

          {error && touched ? <Notice message={error} /> : null}

          <Field
            label="Full name"
            value={name}
            onChangeText={setName}
            placeholder="Aashish Shrestha"
            error={touched ? nameError : null}
          />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            error={touched ? emailError : null}
          />
          <Field
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="98XXXXXXXX"
            keyboardType="phone-pad"
            autoCapitalize="none"
            error={touched ? phoneError : null}
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            error={touched ? passwordError : null}
          />

          <ChoiceRow
            label="Skill level"
            options={LEVELS as readonly string[]}
            value={level}
            onChange={setLevel}
          />
          <ChoiceRow
            label="Preferred position"
            options={POSITIONS as readonly string[]}
            value={position}
            onChange={setPosition}
          />

          <Button label="Create account" onPress={submit} loading={busy} />

          <View style={styles.footerRow}>
            <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
              Already have an account?{" "}
            </Text>
            <Link href="/login" asChild>
              <Text style={[styles.link, { color: colors.primary }]}>Sign in</Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Wrapping row of selectable chips. */
function ChoiceRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.choiceBlock}>
      <Text style={[styles.choiceLabel, { color: colors.textMuted }]}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((opt) => {
          const active = opt === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color: active ? colors.primaryText : colors.text,
                  fontSize: fontSize.sm,
                  fontWeight: "500",
                }}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space.xl, paddingTop: space.xl, paddingBottom: space.xxl },
  title: { fontSize: fontSize.xl, fontWeight: "700" },
  subtitle: { fontSize: fontSize.sm, color: "#64748B", marginTop: space.xs, marginBottom: space.xl },
  choiceBlock: { marginBottom: space.lg },
  choiceLabel: { fontSize: fontSize.sm, marginBottom: space.sm, fontWeight: "500" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
  },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: space.xl },
  link: { fontSize: fontSize.sm, fontWeight: "600" },
});
