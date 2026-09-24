import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, Notice } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { API_BASE, ApiError } from "@/lib/api";
import { firstError, validateEmail } from "@/lib/validation";
import { colors as tokens, fontSize, space } from "@/theme";

/**
 * Sign in.
 *
 * The email rule comes straight from the ported src/lib/validation.ts — the same
 * module the Next.js app uses, byte for byte. That is the point of the
 * migration: the rules are written once and both apps share them, so a player
 * cannot be told "invalid email" here and then rejected differently on the web.
 */
export default function Login() {
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailError = validateEmail(email);

  async function submit() {
    setTouched(true);
    setError(null);

    // Same first-message-wins convention as the web forms.
    const invalid = firstError(emailError, password ? null : "Enter your password");
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(app)");
    } catch (e) {
      // Surface the server's own wording — these routes return specific
      // messages like "Incorrect password. Try again — or reset it! 🔑".
      setError(e instanceof ApiError ? e.message : "Could not sign in. Check your connection.");
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
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.logo, { color: colors.primary }]}>⚽</Text>
            <Text style={[styles.title, { color: colors.text }]}>Futsal Nepal</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              Book a court in under a minute
            </Text>
          </View>

          {error && touched ? <Notice message={error} /> : null}

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
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            autoCapitalize="none"
          />

          <Button label="Sign in" onPress={submit} loading={busy} />

          <Link href="/forgot-password" asChild>
            <Text
              style={StyleSheet.flatten([
                styles.forgot,
                { color: tokens.orange600 },
              ])}
            >
              Forgot your password? 🔑
            </Text>
          </Link>

          <View style={styles.footerRow}>
            <Text style={{ color: colors.textMuted, fontSize: fontSize.base }}>
              New here?{" "}
            </Text>
            <Link href="/signup" asChild>
              {/* Slot can't merge an array style, so flatten it to one object. */}
              <Text style={StyleSheet.flatten([styles.link, { color: colors.primary }])}>
                Create an account
              </Text>
            </Link>
          </View>

          {/*
            Show the API base this bundle was built with. EXPO_PUBLIC_API_BASE is
            inlined at build time, so if a .env edit didn't take (stale Metro
            cache — restart with --clear), this still reads "localhost" and you
            can see that immediately instead of guessing why a device can't
            connect. On a phone, "localhost" is the phone itself, never your
            computer.
          */}
          <Text style={[styles.apiLine, { color: colors.textFaint }]}>
            API: {API_BASE}
            {/localhost|127\.0\.0\.1/.test(API_BASE) ? "  ⚠ device needs your LAN IP" : ""}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space["6"], paddingTop: space["8"], flexGrow: 1 },
  header: { alignItems: "center", marginBottom: space["8"] },
  logo: { fontSize: 44 },
  title: { fontSize: fontSize["4xl"], fontWeight: "700", marginTop: space["2"] },
  subtitle: { fontSize: fontSize.base, marginTop: space["1"] },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: space["6"] },
  forgot: {
    fontSize: fontSize.base,
    fontWeight: "700",
    textAlign: "center",
    marginTop: space[3],
  },
  link: { fontSize: fontSize.base, fontWeight: "600" },
  apiLine: { fontSize: fontSize.sm, textAlign: "center", marginTop: space["4"] },
});
