import { Link, useRouter } from "expo-router";
import {
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  PartyPopper,
  ShieldCheck,
} from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
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
import { requestPasswordResetCode, resetPasswordWithCode } from "@/api";
import { Button, Label, Notice, TextControl } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import {
  firstError,
  passwordStrength,
  validateEmail,
  validatePassword,
} from "@/lib/validation";
import { colors as tokens, fontSize, radius, space } from "@/theme";

/**
 * Forgot your password? 🔑
 *
 * One way back in, on purpose: we email a six-digit code, you type it with a new
 * password. It works whatever device has the inbox and needs no deep link, which
 * the phone-check path could not say — and offering two ways to do one thing
 * mostly meant two sets of failure messages, two things to get wrong, and a
 * screen where half the fields were irrelevant to whoever was looking at it.
 *
 * The reset sets a real password: nothing here creates a "temporary" credential
 * someone has to change later.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { user, ready } = useAuth();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const strength = passwordStrength(newPw);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (ready && user) router.replace(user.role === "owner" ? "/admin" : "/(app)");
  }, [user, ready, router]);

  // "Resend in 42s" — the server enforces one code a minute, so the button
  // counts it down instead of letting people collect 429s.
  useEffect(() => {
    if (cooldown <= 0) {
      if (tick.current) clearInterval(tick.current);
      return;
    }
    tick.current = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
  }, [cooldown]);

  async function sendCode() {
    const emailError = validateEmail(email);
    if (emailError) {
      setFieldErrors({ email: emailError });
      setError(emailError);
      return;
    }

    setBusy(true);
    setSendingCode(true);
    setError("");
    setNotice("");
    try {
      await requestPasswordResetCode(email.trim().toLowerCase());
      setCodeSent(true);
      setCooldown(60);
      setNotice(`If ${email.trim().toLowerCase()} has an account, a 6-digit code is on its way. Check spam if it is not there in a minute.`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not send the code. Try again.";
      // 429 is the cooldown/limit talking — keep the code box visible either way.
      setError(message);
      if (err instanceof ApiError && err.status === 429) {
        setCooldown(60);
        setCodeSent(true);
      }
    } finally {
      setBusy(false);
      setSendingCode(false);
    }
  }

  async function submitCode() {
    const errs: Record<string, string> = {};
    const em = validateEmail(email);
    if (em) errs.email = em;
    if (code.replace(/\D/g, "").length !== 6) errs.code = "Enter the 6-digit code from your email";
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
      await resetPasswordWithCode({
        email: email.trim().toLowerCase(),
        code: code.replace(/\D/g, ""),
        newPassword: newPw,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  }

  const strengthBarColor = (i: number) => {
    if (i > strength.score) return c.border;
    if (strength.score <= 1) return tokens.red400;
    if (strength.score === 2) return tokens.amber400;
    return tokens.emerald500;
  };

  const passwordBlock = (
    <View style={styles.fieldBlock}>
      <Label style={styles.labelFlush}>New password (min 6 chars)</Label>
      <TextControl
        value={newPw}
        onChangeText={(t) => {
          setNewPw(t);
          setFieldErrors((p) => ({ ...p, newPw: "" }));
        }}
        placeholder="Something memorable"
        icon={<Lock size={16} color={c.textFaint} />}
        secureTextEntry={!showPw}
        autoCapitalize="none"
        autoComplete="password"
        textContentType="newPassword"
        maxLength={100}
        error={Boolean(fieldErrors.newPw)}
        accessibilityLabel="New password"
        right={
          <Pressable onPress={() => setShowPw((v) => !v)} accessibilityLabel={showPw ? "Hide password" : "Show password"}>
            {showPw ? <EyeOff size={16} color={c.textFaint} /> : <Eye size={16} color={c.textFaint} />}
          </Pressable>
        }
      />
      {newPw ? (
        <View style={styles.strengthWrap}>
          <View style={styles.strengthBars}>
            {[1, 2, 3, 4].map((i) => (
              <View key={i} style={[styles.strengthBar, { backgroundColor: strengthBarColor(i) }]} />
            ))}
          </View>
          <Text style={[styles.strengthLabel, { color: c.textMuted }]}>
            {strength.emoji} {strength.label}
          </Text>
        </View>
      ) : null}
      {fieldErrors.newPw ? <Text style={[styles.fieldError, { color: c.dangerText }]}>{fieldErrors.newPw}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            <Link href="/login" asChild>
              <Pressable
                style={StyleSheet.flatten([styles.back, { backgroundColor: c.surface, borderColor: c.border }])}
                accessibilityRole="button"
              >
                <ChevronLeft size={16} color={c.text} />
                <Text style={[styles.backText, { color: c.text }]}>Back to login</Text>
              </Pressable>
            </Link>

            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow }]}>
              <View style={styles.hero}>
                <View style={styles.heroIcon}>
                  <KeyRound size={28} color={tokens.orange600} strokeWidth={2.5} />
                </View>
                <Text style={styles.heroTitle}>Forgot your password? 🔑</Text>
                <Text style={styles.heroSub}>
                  We email you a 6-digit code — no link to hunt for
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
                  <View style={styles.fieldBlock}>
                    <Label style={styles.labelFlush}>Your account email</Label>
                    <TextControl
                      value={email}
                      onChangeText={(t) => {
                        setEmail(t);
                        setFieldErrors((p) => ({ ...p, email: "" }));
                      }}
                      placeholder="you@example.com"
                      icon={<Mail size={16} color={c.textFaint} />}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      textContentType="emailAddress"
                      maxLength={100}
                      error={Boolean(fieldErrors.email)}
                      accessibilityLabel="Account email"
                      returnKeyType={codeSent ? "next" : "go"}
                      onSubmitEditing={() => (!codeSent ? void sendCode() : undefined)}
                    />
                    {fieldErrors.email ? (
                      <Text style={[styles.fieldError, { color: c.dangerText }]}>{fieldErrors.email}</Text>
                    ) : null}
                  </View>

                  {!codeSent ? (
                        <Button
                          label={sendingCode ? "Sending the code…" : "Email me a reset code ✉️"}
                          onPress={() => void sendCode()}
                          loading={sendingCode}
                        />
                      ) : (
                        <>
                          <View style={styles.fieldBlock}>
                            <Label style={styles.labelFlush}>6-digit code</Label>
                            <TextControl
                              value={code}
                              onChangeText={(t) => {
                                setCode(t.replace(/\D/g, "").slice(0, 6));
                                setFieldErrors((p) => ({ ...p, code: "" }));
                              }}
                              placeholder="123456"
                              icon={<ShieldCheck size={16} color={c.textFaint} />}
                              keyboardType="number-pad"
                              autoComplete="one-time-code"
                              textContentType="oneTimeCode"
                              maxLength={6}
                              error={Boolean(fieldErrors.code)}
                              accessibilityLabel="Reset code"
                            />
                            {fieldErrors.code ? (
                              <Text style={[styles.fieldError, { color: c.dangerText }]}>{fieldErrors.code}</Text>
                            ) : null}
                          </View>

                          {passwordBlock}

                          <Pressable
                            onPress={() => void sendCode()}
                            disabled={cooldown > 0 || sendingCode}
                            accessibilityRole="button"
                            style={styles.resend}
                          >
                            <Text style={[styles.resendText, { color: cooldown > 0 ? c.textFaint : c.primary }]}>
                              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Send a new code"}
                            </Text>
                          </Pressable>

                          <Button
                            label={busy ? "Resetting…" : "Reset my password 🔑"}
                            onPress={() => void submitCode()}
                            loading={busy}
                          />
                        </>
                  )}

                  {notice ? <Notice message={notice} tone="info" /> : null}
                  {error ? <Notice message={error} /> : null}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space[4], paddingBottom: space[10], flexGrow: 1, justifyContent: "center" },
  column: { width: "100%", maxWidth: 448, alignSelf: "center" },

  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    marginBottom: space[4],
  },
  backText: { fontSize: fontSize.sm, fontWeight: "900" },

  card: {
    borderRadius: 32,
    borderWidth: 1,
    overflow: "hidden",
    shadowOpacity: 0.14,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },

  // Orange hero, like Login's and Signup's green one: the same orange either way
  // so the title stays readable in light and dark mode.
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
  heroTitle: { marginTop: space[3], color: "#FFFFFF", fontSize: fontSize["2xl"], fontWeight: "900", textAlign: "center" },
  heroSub: { marginTop: space[1], color: tokens.orange100, fontSize: fontSize.base, lineHeight: 20, textAlign: "center" },

  form: { padding: space[6], paddingTop: space[5], gap: space[3] },

  fieldBlock: { gap: space[1] },
  // `Label` carries its own bottom margin; inside a gap'd block that doubles up.
  labelFlush: { marginBottom: 0 },
  fieldError: { fontSize: fontSize.xs, fontWeight: "700" },
  strengthWrap: { gap: 4, marginTop: space[1] },
  strengthBars: { flexDirection: "row", gap: 4 },
  strengthBar: { height: 6, flex: 1, borderRadius: 99 },
  strengthLabel: { fontSize: fontSize.xs, fontWeight: "700" },
  resend: { alignSelf: "center", paddingVertical: space[1] },
  resendText: { fontSize: fontSize.sm, fontWeight: "800" },

  doneBox: { padding: space[7], alignItems: "center", gap: space[3] },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: tokens.emerald600,
    alignItems: "center",
    justifyContent: "center",
  },
  doneTitle: { fontSize: fontSize["2xl"], fontWeight: "900" },
  doneBody: { fontSize: fontSize.base, lineHeight: 21, textAlign: "center", marginBottom: space[2] },
});
