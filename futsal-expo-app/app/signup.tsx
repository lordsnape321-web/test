import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
import { Check, ChevronLeft, Crown, Eye, EyeOff, Lock, Trophy, Zap } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
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
import { Picker } from "@/components/ThemedPicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { seedDemo } from "@/api";
import { Button, Field, Notice } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useBreakpoints } from "@/lib/responsive";
import { ApiError } from "@/lib/api";
import { CITY_OPTIONS } from "@/lib/futsal";
import {
  firstError,
  passwordStrength,
  validateCity,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} from "@/lib/validation";
import { colors as tokens, fontSize, radius, space } from "@/theme";

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

/**
 * Account creation, including the owner's path from the web app. Owners and
 * players use the same API contract; an owner simply lands in Owner Studio
 * after signup instead of being dropped into the player tabs.
 */
export default function Signup() {
  const { colors: c, isDark } = useTheme();
  const { signUp, user, ready } = useAuth();
  const router = useRouter();
  const { sm } = useBreakpoints();

  const [role, setRole] = useState<"player" | "owner">("player");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [level, setLevel] = useState<string>("Intermediate");
  const [position, setPosition] = useState<string>("All-rounder");
  const [defaultCity, setDefaultCity] = useState("Kathmandu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const nameError = validateName(name);
  const emailError = validateEmail(email);
  const phoneError = validatePhone(phone, { required: true });
  const passwordError = validatePassword(password);
  const cityError = validateCity(defaultCity, "Home city");
  const strength = useMemo(() => passwordStrength(password), [password]);

  // Match the web auth pages: seeded demo accounts are available immediately
  // when someone opens signup from a fresh development database.
  useEffect(() => {
    void seedDemo().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (ready && user) router.replace(user.role === "owner" ? "/admin" : "/");
  }, [ready, user, router]);

  async function submit() {
    setTouched(true);
    setError(null);
    const invalid = firstError(nameError, emailError, phoneError, passwordError, cityError);
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    try {
      const next = await signUp({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        role,
        level,
        position,
        defaultCity,
      });
      router.replace(next.role === "owner" ? "/admin" : "/venues");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create your account. Try again shortly.");
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
            <LinearGradient
              colors={isDark ? ["#065F46", "#14532D"] : ["#047857", "#166534"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <View style={styles.heroIcon}>
                <Trophy size={28} color={tokens.emerald700} strokeWidth={2.5} />
              </View>
              <Text style={styles.heroTitle}>Come join the family ⚽</Text>
              <Text style={styles.heroSub}>Free forever for players — tell us a little about yourself</Text>
            </LinearGradient>

            <View style={styles.form}>
              <View style={styles.roleGrid}>
                <RoleCard
                  active={role === "player"}
                  icon={<Zap size={20} color={role === "player" ? tokens.emerald600 : c.textFaint} />}
                  title="I want to play"
                  subtitle="Book courts, join games & teams"
                  onPress={() => setRole("player")}
                  activeColor={tokens.emerald600}
                  colors={c}
                />
                <RoleCard
                  active={role === "owner"}
                  icon={<Crown size={20} color={role === "owner" ? tokens.orange500 : c.textFaint} />}
                  title="I own a court"
                  subtitle="Welcome players, grow bookings"
                  onPress={() => setRole("owner")}
                  activeColor={tokens.orange500}
                  colors={c}
                />
              </View>

              <Field label="What should we call you?" value={name} onChangeText={setName} placeholder="Your name" error={touched ? nameError : null} />
              {sm ? (
                <View style={styles.twoCol}>
                  <View style={styles.twoColItem}>
                    <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@mail.com" keyboardType="email-address" autoCapitalize="none" error={touched ? emailError : null} />
                  </View>
                  <View style={styles.twoColItem}>
                    <Field label="Phone (one account per number)" value={phone} onChangeText={setPhone} placeholder="98XXXXXXXX" keyboardType="phone-pad" autoCapitalize="none" error={touched ? phoneError : null} />
                  </View>
                </View>
              ) : (
                <>
                  <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@mail.com" keyboardType="email-address" autoCapitalize="none" error={touched ? emailError : null} />
                  <Field label="Phone (one account per number)" value={phone} onChangeText={setPhone} placeholder="98XXXXXXXX" keyboardType="phone-pad" autoCapitalize="none" error={touched ? phoneError : null} />
                </>
              )}

              <View style={styles.fieldBlock}>
                <Text style={[styles.label, { color: c.textFaint }]}>Pick a password (min 6 chars)</Text>
                <View style={[styles.passwordWrap, { backgroundColor: inputFill, borderColor: touched && passwordError ? tokens.red400 : c.border }]}>
                  <Lock size={16} color={c.textFaint} />
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Something you&apos;ll remember"
                    placeholderTextColor={c.textFaint}
                    secureTextEntry={!showPw}
                    autoCapitalize="none"
                    maxLength={100}
                    style={[styles.passwordInput, { color: c.text }]}
                  />
                  <Pressable onPress={() => setShowPw((v) => !v)} accessibilityLabel={showPw ? "Hide password" : "Show password"}>
                    {showPw ? <EyeOff size={17} color={c.textFaint} /> : <Eye size={17} color={c.textFaint} />}
                  </Pressable>
                </View>
                {password ? (
                  <View style={styles.strengthWrap}>
                    <View style={styles.strengthBars}>
                      {[1, 2, 3, 4].map((i) => (
                        <View key={i} style={[styles.strengthBar, { backgroundColor: i <= strength.score ? (strength.score <= 1 ? tokens.red400 : strength.score === 2 ? tokens.amber400 : tokens.emerald500) : c.border }]} />
                      ))}
                    </View>
                    <Text style={[styles.strengthLabel, { color: c.textMuted }]}>
                      {strength.emoji} {strength.label}
                      {strength.tips.length > 0 && password.length >= 6 ? ` • try: ${strength.tips.slice(0, 2).join(", ")}` : ""}
                    </Text>
                  </View>
                ) : null}
                {touched && passwordError ? <Text style={styles.error}>{passwordError}</Text> : null}
              </View>

              <View style={styles.fieldBlock}>
                <Text style={[styles.label, { color: c.textFaint }]}>Home city 🏠 — your search starts here</Text>
                <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: touched && cityError ? tokens.red400 : c.border }]}>
                  <Picker selectedValue={defaultCity} onValueChange={(v) => setDefaultCity(String(v))} style={{ color: c.text }} dropdownIconColor={c.textMuted}>
                    {CITY_OPTIONS.filter((city) => city !== "All Cities").map((city) => <Picker.Item key={city} label={city} value={city} />)}
                  </Picker>
                </View>
                {touched && cityError ? <Text style={styles.error}>{cityError}</Text> : null}
              </View>

              {role === "player" ? (
                <View style={[styles.preferenceGrid, sm ? styles.preferenceGridWide : null]}>
                  <View style={sm ? styles.preferenceCell : null}>
                    <ChoiceRow label="Your level" options={LEVELS} value={level} onChange={setLevel} />
                  </View>
                  <View style={sm ? styles.preferenceCell : null}>
                    <ChoiceRow label="Favourite spot" options={POSITIONS} value={position} onChange={setPosition} />
                  </View>
                </View>
              ) : (
                <View style={[styles.ownerNote, { backgroundColor: isDark ? "rgba(249,115,22,0.12)" : tokens.orange50, borderColor: isDark ? "rgba(249,115,22,0.3)" : tokens.orange100 }]}>
                  <Crown size={16} color={tokens.orange500} />
                  <Text style={[styles.ownerNoteText, { color: isDark ? tokens.orange300 : tokens.orange700 }]}>Owner accounts can list venues, add courts, manage requests, and run leagues from Owner Studio.</Text>
                </View>
              )}

              {error ? <Notice message={error} /> : null}
              <Button
                label={busy ? "Setting things up…" : role === "owner" ? "List my court 🎉" : "Join & start playing 🎉"}
                onPress={() => void submit()}
                loading={busy}
              />

              <View style={styles.footerRow}>
                <Text style={{ color: c.textMuted, fontSize: fontSize.base }}>Already have an account? </Text>
                <Link href="/login" asChild><Text style={StyleSheet.flatten([styles.link, { color: c.primary }])}>Sign in</Text></Link>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoleCard({ active, icon, title, subtitle, onPress, activeColor, colors: c }: { active: boolean; icon: React.ReactNode; title: string; subtitle: string; onPress: () => void; activeColor: string; colors: { surface: string; border: string; text: string; textMuted: string; textFaint: string } }) {
  return (
    <Pressable onPress={onPress} style={[styles.roleCard, { backgroundColor: active ? `${activeColor}12` : c.surface, borderColor: active ? activeColor : c.border }]} accessibilityRole="button" accessibilityState={{ selected: active }}>
      {active ? <View style={[styles.check, { backgroundColor: activeColor }]}><Check size={12} color="#FFFFFF" strokeWidth={3.5} /></View> : null}
      {icon}
      <Text style={[styles.roleTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.roleSubtitle, { color: c.textMuted }]}>{subtitle}</Text>
    </Pressable>
  );
}

function ChoiceRow({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string; onChange: (value: string) => void }) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.label, { color: c.textFaint }]}>{label}</Text>
      <View style={[styles.pickerWrap, { backgroundColor: c.inset, borderColor: c.border }]}>
        <Picker selectedValue={value} onValueChange={(next) => onChange(String(next))} style={{ color: c.text }} dropdownIconColor={c.textMuted}>
          {options.map((option) => <Picker.Item key={option} label={option} value={option} />)}
        </Picker>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space[4], paddingBottom: space[10], justifyContent: "center", flexGrow: 1 },
  back: { width: "100%", maxWidth: 448, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 2, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space[4], paddingVertical: space[2], marginBottom: space[4] },
  backText: { fontSize: fontSize.sm, fontWeight: "900" },
  card: { width: "100%", maxWidth: 448, alignSelf: "center", borderWidth: 1, borderRadius: 32, overflow: "hidden", shadowColor: "#B4783C", shadowOpacity: 0.14, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 4 },
  twoCol: { flexDirection: "row", gap: space[3] },
  twoColItem: { flex: 1 },
  preferenceGrid: { gap: space[3] },
  preferenceGridWide: { flexDirection: "row" },
  preferenceCell: { flex: 1 },
  hero: { padding: space[7], alignItems: "center" },
  heroIcon: { width: 56, height: 56, borderRadius: radius["2xl"], backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  heroTitle: { marginTop: space[3], color: "#FFFFFF", fontSize: fontSize["2xl"], fontWeight: "900", textAlign: "center" },
  heroSub: { marginTop: space[1], color: "rgba(209,250,229,0.85)", fontSize: fontSize.base, textAlign: "center", lineHeight: 20 },
  form: { padding: space[6], gap: space[3] },
  roleGrid: { flexDirection: "row", gap: space[2], marginBottom: space[2] },
  roleCard: { flex: 1, minHeight: 118, borderWidth: 1, borderRadius: radius["2xl"], padding: space[3], position: "relative" },
  check: { position: "absolute", top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  roleTitle: { marginTop: space[2], fontSize: fontSize.base, fontWeight: "900" },
  roleSubtitle: { marginTop: 2, fontSize: fontSize.xs, lineHeight: 16 },
  fieldBlock: { gap: space[1] },
  label: { fontSize: fontSize.sm, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  passwordWrap: { minHeight: 48, borderWidth: 1, borderRadius: radius["2xl"], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[2] },
  passwordInput: { flex: 1, fontSize: 16, fontWeight: "600", paddingVertical: 11 },
  pickerWrap: { borderWidth: 1, borderRadius: radius["2xl"], overflow: "hidden", minHeight: 48, justifyContent: "center" },
  hint: { fontSize: fontSize.xs, fontWeight: "600" },
  error: { fontSize: fontSize.xs, color: tokens.red500, fontWeight: "700" },
  strengthWrap: { gap: 4 },
  strengthBars: { flexDirection: "row", gap: 4 },
  strengthBar: { height: 6, flex: 1, borderRadius: 99 },
  strengthLabel: { fontSize: fontSize.xs, fontWeight: "700" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  choice: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[2], minHeight: 40, justifyContent: "center" },
  ownerNote: { flexDirection: "row", alignItems: "flex-start", gap: space[2], borderWidth: 1, borderRadius: radius.xl, padding: space[3] },
  ownerNoteText: { flex: 1, fontSize: fontSize.xs, fontWeight: "700", lineHeight: 17 },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: space[2] },
  link: { fontSize: fontSize.base, fontWeight: "900" },
});
