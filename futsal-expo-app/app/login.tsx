import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
import { ChevronLeft, Crown, Eye, EyeOff, Lock, LogIn, Mail, Trophy, Zap } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { seedDemo } from "@/api";
import { Button, Notice } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import { firstError, validateEmail } from "@/lib/validation";
import { colors as tokens, fontSize, radius, space } from "@/theme";

/** Sign in, with the same demo shortcuts and owner routing as the web page. */
export default function Login() {
  const { colors: c, isDark } = useTheme();
  const { signIn, user, ready } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    void seedDemo().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (ready && user) router.replace(user.role === "owner" ? "/admin" : "/");
  }, [ready, user, router]);

  async function submit(demo?: { email: string; password: string }) {
    setTouched(true);
    setError(null);
    const nextEmail = demo?.email ?? email;
    const nextPassword = demo?.password ?? password;
    const invalid = demo ? null : firstError(validateEmail(nextEmail), nextPassword ? null : "Password is required 🔒");
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    try {
      const next = await signIn(nextEmail.trim(), nextPassword);
      // Route from the server role, not an email allow-list: this also handles
      // every owner account created from the signup screen.
      router.replace(next.role === "owner" ? "/admin" : "/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not sign in. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const inputFill = isDark ? "rgba(255,255,255,0.05)" : tokens.insetCream;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Link href="/" asChild>
            <Pressable style={StyleSheet.flatten([styles.back, { backgroundColor: c.surface, borderColor: c.border }])}>
              <ChevronLeft size={16} color={c.text} />
              <Text style={[styles.backText, { color: c.text }]}>Back home</Text>
            </Pressable>
          </Link>
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <LinearGradient colors={isDark ? ["#065F46", "#14532D"] : ["#047857", "#166534"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
              <View style={styles.heroIcon}><Trophy size={28} color={tokens.emerald700} strokeWidth={2.5} /></View>
              <Text style={styles.heroTitle}>Welcome back, friend! 👋</Text>
              <Text style={styles.heroSub}>Your crew saved you a spot — let&apos;s get you back on court</Text>
            </LinearGradient>

            <View style={styles.form}>
              <Text style={[styles.label, { color: c.textFaint }]}>Email</Text>
              <View style={[styles.inputWrap, { backgroundColor: inputFill, borderColor: touched && validateEmail(email) ? tokens.red400 : c.border }]}>
                <Mail size={16} color={c.textFaint} />
                <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={c.textFaint} keyboardType="email-address" autoCapitalize="none" maxLength={100} style={[styles.input, { color: c.text }]} />
              </View>
              {touched && validateEmail(email) ? <Text style={styles.error}>{validateEmail(email)}</Text> : null}

              <Text style={[styles.label, { color: c.textFaint }]}>Password</Text>
              <View style={[styles.inputWrap, { backgroundColor: inputFill, borderColor: touched && !password ? tokens.red400 : c.border }]}>
                <Lock size={16} color={c.textFaint} />
                <TextInput value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={c.textFaint} secureTextEntry={!showPw} autoCapitalize="none" maxLength={100} style={[styles.input, { color: c.text }]} />
                <Pressable onPress={() => setShowPw((v) => !v)} accessibilityLabel={showPw ? "Hide password" : "Show password"}>{showPw ? <EyeOff size={17} color={c.textFaint} /> : <Eye size={17} color={c.textFaint} />}</Pressable>
              </View>
              {touched && !password ? <Text style={styles.error}>Password is required 🔒</Text> : null}

              {error ? <Notice message={error} /> : null}
              <Button
                label={busy ? "Getting you in…" : "Log in & play"}
                onPress={() => void submit()}
                loading={busy}
                icon={<LogIn size={16} color={c.primaryText} />}
              />

              <View style={styles.dividerRow}><View style={[styles.divider, { backgroundColor: c.border }]} /><Text style={[styles.dividerText, { color: c.textFaint }]}>Just looking around?</Text><View style={[styles.divider, { backgroundColor: c.border }]} /></View>
              <View style={styles.demoRow}>
                <Pressable disabled={busy} onPress={() => void submit({ email: "aarav@futsal.np", password: "futsal123" })} style={[styles.demo, { borderColor: tokens.emerald100, backgroundColor: isDark ? "rgba(16,185,129,0.1)" : tokens.emerald50 }]}><Zap size={16} color={tokens.emerald600} /><Text style={[styles.demoText, { color: isDark ? tokens.emerald300 : tokens.emerald700 }]}>Try as Player</Text></Pressable>
                <Pressable disabled={busy} onPress={() => void submit({ email: "ganesh@futsal.np", password: "futsal123" })} style={[styles.demo, { borderColor: tokens.orange100, backgroundColor: isDark ? "rgba(249,115,22,0.1)" : tokens.orange50 }]}><Crown size={16} color={tokens.orange500} /><Text style={[styles.demoText, { color: isDark ? tokens.orange300 : tokens.orange700 }]}>Try as Owner</Text></Pressable>
              </View>

              <Link href="/forgot-password" asChild><Text style={StyleSheet.flatten([styles.forgot, { color: tokens.orange600 }])}>Forgot your password? 🔑</Text></Link>
              <View style={styles.footerRow}><Text style={{ color: c.textMuted, fontSize: fontSize.base }}>New to the family? </Text><Link href="/signup" asChild><Text style={StyleSheet.flatten([styles.link, { color: c.primary }])}>Join us — it&apos;s free</Text></Link></View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space[4], paddingBottom: space[10], justifyContent: "center", flexGrow: 1 },
  back: { width: "100%", maxWidth: 448, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 2, marginBottom: 12, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderRadius: 999 },
  backText: { fontSize: 12, fontWeight: "900" },
  card: { width: "100%", maxWidth: 448, alignSelf: "center", borderWidth: 1, borderRadius: 32, overflow: "hidden", shadowColor: "#B4783C", shadowOpacity: 0.14, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 4 },
  hero: { padding: space[7], alignItems: "center" },
  heroIcon: { width: 56, height: 56, borderRadius: radius["2xl"], backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  heroTitle: { marginTop: space[3], color: "#FFFFFF", fontSize: fontSize["2xl"], fontWeight: "900", textAlign: "center" },
  heroSub: { marginTop: space[1], color: "rgba(209,250,229,0.85)", fontSize: fontSize.base, textAlign: "center", lineHeight: 20 },
  form: { padding: space[6], gap: space[2.5] },
  label: { fontSize: fontSize.sm, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  inputWrap: { minHeight: 48, borderWidth: 1, borderRadius: radius["2xl"], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[2] },
  input: { flex: 1, fontSize: 16, fontWeight: "600", paddingVertical: 11 },
  error: { fontSize: fontSize.xs, color: tokens.red500, fontWeight: "700" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] },
  divider: { height: 1, flex: 1 },
  dividerText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2 },
  demoRow: { flexDirection: "row", gap: space[2] },
  demo: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: radius["2xl"], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: space[2] },
  demoText: { fontSize: fontSize.xs, fontWeight: "900" },
  forgot: { fontSize: fontSize.base, fontWeight: "800", textAlign: "center", marginTop: space[2] },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: space[1] },
  link: { fontSize: fontSize.base, fontWeight: "900" },
});
