import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
import { Crown, Eye, EyeOff, Lock, LogIn, Mail, Trophy, Zap } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ensureDemoSeed } from "@/lib/demo-seed";
import { Button, Label, Notice, TextControl } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError, apiBase, defaultApiBase, savedApiBase, setSavedApiBase } from "@/lib/api";
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

  // Which backend this device talks to. A dev build derives it from the Metro
  // server it was loaded from; an installed APK has no Metro server, so the
  // address has to be settable here — once, from the machine running Laravel
  // (`http://192.168.1.20:8000` on the same Wi-Fi).
  const [serverOpen, setServerOpen] = useState(false);
  const [serverDraft, setServerDraft] = useState("");
  const [serverSaved, setServerSaved] = useState(false);
  const activeBase = apiBase();
  const shownBase = activeBase || `${defaultApiBase()} (same origin)`;

  function openServer() {
    setServerDraft(savedApiBase());
    setServerSaved(false);
    setServerOpen(true);
  }

  /** Save the typed origin (or clear it, when left empty) and say so. */
  function saveServer() {
    setSavedApiBase(serverDraft);
    setServerSaved(true);
  }

  useEffect(() => {
    // Demo data, once a session at most, and never blocking the screen. See
    // `ensureDemoSeed` — awaiting it here used to put a POST in front of login.
    void ensureDemoSeed();
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

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow }]}>
            <LinearGradient colors={isDark ? ["#065F46", "#14532D"] : ["#047857", "#166534"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
              <View style={styles.heroIcon}><Trophy size={28} color={tokens.emerald700} strokeWidth={2.5} /></View>
              <Text style={styles.heroTitle}>Sign in 👋</Text>
              <Text style={styles.heroSub}>Your bookings, games and teams are waiting.</Text>
            </LinearGradient>

            <View style={styles.form}>
              <View style={styles.fieldBlock}>
                <Label style={styles.labelFlush}>Email</Label>
                <TextControl
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  icon={<Mail size={16} color={c.textFaint} />}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  maxLength={100}
                  error={Boolean(touched && validateEmail(email))}
                  accessibilityLabel="Email"
                  returnKeyType="next"
                />
                {touched && validateEmail(email) ? <Text style={[styles.error, { color: c.dangerText }]}>{validateEmail(email)}</Text> : null}
              </View>

              <View style={styles.fieldBlock}>
                <Label style={styles.labelFlush}>Password</Label>
                <TextControl
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  icon={<Lock size={16} color={c.textFaint} />}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="password"
                  maxLength={100}
                  error={Boolean(touched && !password)}
                  accessibilityLabel="Password"
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                  right={
                    <Pressable onPress={() => setShowPw((v) => !v)} accessibilityLabel={showPw ? "Hide password" : "Show password"}>
                      {showPw ? <EyeOff size={17} color={c.textFaint} /> : <Eye size={17} color={c.textFaint} />}
                    </Pressable>
                  }
                />
                {touched && !password ? <Text style={[styles.error, { color: c.dangerText }]}>Password is required 🔒</Text> : null}
              </View>

              {error ? <Notice message={error} /> : null}
              <Button
                label={busy ? "Getting you in…" : "Log in & play"}
                onPress={() => void submit()}
                loading={busy}
                icon={<LogIn size={16} color={c.primaryText} />}
              />

              <View style={styles.dividerRow}><View style={[styles.divider, { backgroundColor: c.border }]} /><Text style={[styles.dividerText, { color: c.textFaint }]}>Just looking around?</Text><View style={[styles.divider, { backgroundColor: c.border }]} /></View>
              <View style={styles.demoRow}>
                <Pressable disabled={busy} onPress={() => void submit({ email: "aayush.adhikari@futsal.np", password: "futsal123" })} style={[styles.demo, { borderColor: c.successBorder, backgroundColor: c.successBg }]}><Zap size={16} color={c.successText} /><Text style={[styles.demoText, { color: c.successText }]}>Try as Player</Text></Pressable>
                <Pressable disabled={busy} onPress={() => void submit({ email: "prabin.shakya@futsal.np", password: "futsal123" })} style={[styles.demo, { borderColor: c.warningBorder, backgroundColor: c.warningBg }]}><Crown size={16} color={c.accent} /><Text style={[styles.demoText, { color: c.warningText }]}>Try as Owner</Text></Pressable>
              </View>

              <Link href="/forgot-password" asChild><Text style={StyleSheet.flatten([styles.forgot, { color: c.accent }])}>Forgot your password? 🔑</Text></Link>

              <Pressable onPress={openServer} accessibilityRole="button" style={styles.serverRow}>
                <Text style={[styles.serverText, { color: c.textFaint }]} numberOfLines={1}>
                  ⚙️ Server: {shownBase}
                </Text>
                <Text style={[styles.serverChange, { color: c.primary }]}>Change</Text>
              </Pressable>
              <View style={styles.footerRow}><Text style={{ color: c.textMuted, fontSize: fontSize.base }}>New here? </Text><Link href="/signup" asChild><Text style={StyleSheet.flatten([styles.link, { color: c.primary }])}>Create an account — it&apos;s free</Text></Link></View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Server address — for an installed build with no dev server to ask. */}
      <Modal
        visible={serverOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setServerOpen(false)}
      >
        <View style={styles.serverBackdrop}>
          <View style={[styles.serverCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.serverTitle, { color: c.text }]}>Server address</Text>
            <Text style={[styles.serverHint, { color: c.textMuted }]}>
              The backend this app talks to. On a phone, `localhost` is the phone itself, so use
              the computer running Laravel and the same Wi-Fi — for example
              http://192.168.1.20:8000.
            </Text>
            <TextInput
              value={serverDraft}
              onChangeText={(t) => {
                setServerDraft(t);
                setServerSaved(false);
              }}
              placeholder={defaultApiBase() || "https://api.example.com"}
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.serverInput,
                { borderColor: c.border, color: c.text, backgroundColor: c.inset },
              ]}
            />
            {serverSaved ? (
              <Text style={[styles.serverSaved, { color: c.successText }]}>
                Saved — the next request uses it. {activeBase ? `Now: ${activeBase}` : ""}
              </Text>
            ) : null}
            <View style={styles.serverActions}>
              <Pressable
                onPress={() => {
                  setServerDraft("");
                  setSavedApiBase("");
                  setServerSaved(true);
                }}
                accessibilityRole="button"
                style={[styles.serverAction, { borderColor: c.border }]}
              >
                <Text style={{ color: c.textMuted, fontWeight: "800", fontSize: fontSize.sm }}>
                  Use default
                </Text>
              </Pressable>
              <Pressable
                onPress={saveServer}
                accessibilityRole="button"
                style={[styles.serverAction, { borderColor: c.primary, backgroundColor: c.primary }]}
              >
                <Text style={{ color: c.primaryText, fontWeight: "900", fontSize: fontSize.sm }}>
                  Save
                </Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setServerOpen(false)} accessibilityRole="button">
              <Text style={[styles.serverClose, { color: c.textMuted }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space[4], paddingBottom: space[16], justifyContent: "center", flexGrow: 1 },
  card: { width: "100%", maxWidth: 448, alignSelf: "center", borderWidth: 1, borderRadius: 32, overflow: "hidden", shadowColor: "#B4783C", shadowOpacity: 0.14, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 4 },
  hero: { padding: space[7], alignItems: "center" },
  heroIcon: { width: 56, height: 56, borderRadius: radius["2xl"], backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  heroTitle: { marginTop: space[3], color: "#FFFFFF", fontSize: fontSize["2xl"], fontWeight: "900", textAlign: "center" },
  heroSub: { marginTop: space[1], color: "rgba(209,250,229,0.85)", fontSize: fontSize.base, textAlign: "center", lineHeight: 20 },
  form: { padding: space[6], gap: space[3] },
  // The label/control pair every auth screen now shares (components/ui.tsx).
  fieldBlock: { gap: space[1] },
  labelFlush: { marginBottom: 0 },
  error: { fontSize: fontSize.xs, fontWeight: "700" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] },
  divider: { height: 1, flex: 1 },
  dividerText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2 },
  demoRow: { flexDirection: "row", gap: space[2] },
  demo: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: radius["2xl"], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: space[2] },
  demoText: { fontSize: fontSize.xs, fontWeight: "900" },
  forgot: { fontSize: fontSize.base, fontWeight: "800", textAlign: "center", marginTop: space[2] },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: space[1] },
  link: { fontSize: fontSize.base, fontWeight: "900" },
  serverRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2], paddingVertical: space[1] },
  serverText: { fontSize: fontSize.xs, fontWeight: "700", flexShrink: 1 },
  serverChange: { fontSize: fontSize.xs, fontWeight: "900" },
  serverBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", padding: space[4] },
  serverCard: { width: "100%", maxWidth: 448, alignSelf: "center", borderWidth: 1, borderRadius: radius["2xl"], padding: space[5], gap: space[3] },
  serverTitle: { fontSize: fontSize.base, fontWeight: "900" },
  serverHint: { fontSize: fontSize.xs, lineHeight: 17 },
  serverInput: { borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: space[3], minHeight: 44, fontSize: fontSize.sm, fontWeight: "600" },
  serverSaved: { fontSize: fontSize.xs, fontWeight: "800" },
  serverActions: { flexDirection: "row", gap: space[2] },
  serverAction: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  serverClose: { fontSize: fontSize.sm, fontWeight: "800", textAlign: "center", paddingVertical: space[1] },
});
