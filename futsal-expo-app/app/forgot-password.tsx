import { Link, useRouter } from "expo-router";
import {
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  PartyPopper,
  Phone,
} from "lucide-react-native";
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
import { resetPassword } from "@/api";
import { Button, Notice } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import {
  firstError,
  passwordStrength,
  validateEmail,
  validatePassword,
  validatePhone,
} from "@/lib/validation";
import { colors as tokens, fontSize, radius, space } from "@/theme";

/**
 * Forgot your password? 🔑 — a 1:1 port of the web app's
 * app/forgot-password/page.tsx.
 *
 * Prove it's you with email + phone, pick a fresh password. Same validation
 * chain, same strength meter, same success state. The web's signed-in redirect
 * becomes a gate: if auth says we're already signed in, leave immediately.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors: c, isDark } = useTheme();
  const { user, ready } = useAuth();

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const strength = passwordStrength(newPw);
  const inputFill = isDark ? "rgba(255,255,255,0.05)" : tokens.insetCream;

  useEffect(() => {
    if (ready && user) router.replace(user.role === "owner" ? "/admin" : "/(app)");
  }, [user, ready, router]);

  async function submit() {
    const errs: Record<string, string> = {};
    const em = validateEmail(email);
    if (em) errs.email = em;
    const ph = validatePhone(phone, { required: true });
    if (ph) errs.phone = ph;
    const pw = validatePassword(newPw, { label: "New password" });
    if (pw) errs.newPw = pw;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError(firstError(...Object.values(errs)) ?? "Check your details 🙏");
      return;
    }
    setFieldErrors({});
    setError("");
    setBusy(true);
    try {
      await resetPassword({
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        newPassword: newPw,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  const strengthBarColor = (i: number) => {
    if (i > strength.score) return isDark ? "rgba(255,255,255,0.1)" : tokens.stone200;
    if (strength.score <= 1) return tokens.red400;
    if (strength.score === 2) return tokens.amber400;
    return tokens.emerald500;
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Link href="/login" asChild>
            <Pressable
              style={StyleSheet.flatten([styles.back, { backgroundColor: c.surface, borderColor: c.border }])}
              accessibilityRole="button"
            >
              <ChevronLeft size={16} color={c.text} />
              <Text style={[styles.backText, { color: c.text }]}>Back to login</Text>
            </Pressable>
          </Link>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <KeyRound size={28} color={tokens.orange600} strokeWidth={2.5} />
              </View>
              <Text style={styles.heroTitle}>Forgot your password? 🔑</Text>
              <Text style={styles.heroSub}>
                No stress — prove it&apos;s you with your email + phone, and pick a fresh one
              </Text>
            </View>

            {done ? (
              <View style={styles.doneBox}>
                <View style={styles.doneIcon}>
                  <PartyPopper size={32} color="#FFFFFF" />
                </View>
                <Text style={[styles.doneTitle, { color: c.text }]}>All set! 🎉</Text>
                <Text style={[styles.doneBody, { color: c.textMuted }]}>
                  Your password is shiny and new. Log in and get back on court!
                </Text>
                <Button label="Go to login ⚽" onPress={() => router.replace("/login")} />
              </View>
            ) : (
              <View style={styles.form}>
                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>
                  Your account email
                </Text>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: inputFill,
                      borderColor: fieldErrors.email ? tokens.red400 : c.border,
                    },
                  ]}
                >
                  <Mail size={16} color={c.textFaint} />
                  <TextInput
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      setFieldErrors((p) => ({ ...p, email: "" }));
                    }}
                    placeholder="you@example.com"
                    placeholderTextColor={c.textFaint}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    maxLength={100}
                    style={[styles.input, { color: c.text }]}
                  />
                </View>
                {fieldErrors.email ? (
                  <Text style={styles.fieldError}>{fieldErrors.email}</Text>
                ) : null}

                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>
                  Registered phone number
                </Text>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: inputFill,
                      borderColor: fieldErrors.phone ? tokens.red400 : c.border,
                    },
                  ]}
                >
                  <Phone size={16} color={c.textFaint} />
                  <TextInput
                    value={phone}
                    onChangeText={(t) => {
                      setPhone(t);
                      setFieldErrors((p) => ({ ...p, phone: "" }));
                    }}
                    placeholder="98XXXXXXXX"
                    placeholderTextColor={c.textFaint}
                    keyboardType="phone-pad"
                    maxLength={16}
                    style={[styles.input, { color: c.text }]}
                  />
                </View>
                {fieldErrors.phone ? (
                  <Text style={styles.fieldError}>{fieldErrors.phone}</Text>
                ) : null}

                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>
                  New password (min 6 chars)
                </Text>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: inputFill,
                      borderColor: fieldErrors.newPw ? tokens.red400 : c.border,
                    },
                  ]}
                >
                  <Lock size={16} color={c.textFaint} />
                  <TextInput
                    value={newPw}
                    onChangeText={(t) => {
                      setNewPw(t);
                      setFieldErrors((p) => ({ ...p, newPw: "" }));
                    }}
                    placeholder="Something memorable"
                    placeholderTextColor={c.textFaint}
                    secureTextEntry={!showPw}
                    autoCapitalize="none"
                    maxLength={100}
                    style={[styles.input, { color: c.text }]}
                  />
                  <Pressable onPress={() => setShowPw((v) => !v)} accessibilityRole="button">
                    {showPw ? (
                      <EyeOff size={16} color={c.textFaint} />
                    ) : (
                      <Eye size={16} color={c.textFaint} />
                    )}
                  </Pressable>
                </View>
                {newPw ? (
                  <View style={styles.strengthWrap}>
                    <View style={styles.strengthBars}>
                      {[1, 2, 3, 4].map((i) => (
                        <View
                          key={i}
                          style={[styles.strengthBar, { backgroundColor: strengthBarColor(i) }]}
                        />
                      ))}
                    </View>
                    <Text style={[styles.strengthLabel, { color: c.textMuted }]}>
                      {strength.emoji} {strength.label}
                    </Text>
                  </View>
                ) : null}
                {fieldErrors.newPw ? (
                  <Text style={styles.fieldError}>{fieldErrors.newPw}</Text>
                ) : null}

                {error ? <Notice message={error} /> : null}

                <Pressable
                  onPress={() => void submit()}
                  disabled={busy}
                  accessibilityRole="button"
                  style={[styles.submit, busy ? styles.dim : null]}
                >
                  <Text style={styles.submitText}>
                    {busy ? "Resetting…" : "Reset my password 🔑"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space[4], paddingBottom: space[10] },

  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    marginBottom: space[5],
  },
  backText: { fontSize: fontSize.sm, fontWeight: "900" },

  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "rgba(180,120,60,0.15)",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 4,
  },
  hero: {
    backgroundColor: tokens.orange500,
    padding: space[6],
    paddingBottom: space[5],
    alignItems: "center",
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius["2xl"],
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: fontSize["2xl"],
    fontWeight: "900",
    color: "#FFFFFF",
    marginTop: space[3],
    textAlign: "center",
  },
  heroSub: {
    fontSize: fontSize.base,
    color: tokens.orange100,
    marginTop: space[1],
    textAlign: "center",
  },

  doneBox: { padding: space[6], gap: space[3], alignItems: "stretch" },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: tokens.emerald600,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  doneTitle: { fontSize: fontSize.xl, fontWeight: "900", textAlign: "center" },
  doneBody: { fontSize: fontSize.base, textAlign: "center" },

  form: { padding: space[5] },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: space[3],
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
  },
  input: { flex: 1, paddingVertical: 12, fontSize: fontSize.base, fontWeight: "600" },
  fieldError: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: tokens.red500,
    marginTop: 4,
  },

  strengthWrap: { marginTop: 6 },
  strengthBars: { flexDirection: "row", gap: 4 },
  strengthBar: { flex: 1, height: 6, borderRadius: radius.full },
  strengthLabel: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 4 },

  submit: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.orange500,
    borderRadius: radius["2xl"],
    paddingVertical: 14,
    marginTop: space[4],
  },
  submitText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  dim: { opacity: 0.5 },
});
