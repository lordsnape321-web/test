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
  View,
} from "react-native";
import { Picker } from "@/components/ThemedPicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { ensureDemoSeed } from "@/lib/demo-seed";
import { Button, Field, Label, Notice, TextControl } from "@/components/ui";
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
    // Demo data, once a session at most, and never blocking the screen. See
    // `ensureDemoSeed` — awaiting it here used to put a POST in front of login.
    void ensureDemoSeed();
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

  const inputFill = c.inset;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Link href="/" asChild>
            <Pressable style={StyleSheet.flatten([styles.back, { backgroundColor: c.surface, borderColor: c.border }])}>
              <ChevronLeft size={16} color={c.text} />
              <Text style={[styles.backText, { color: c.text }]}>Back home</Text>
            </Pressable>
          </Link>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow }]}>
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
              <View style={styles.roleBlock}>
                <View style={[styles.roleBar, { backgroundColor: c.inset, borderColor: c.border }]}>
                  <RoleOption
                    active={role === "player"}
                    label="I want to play"
                    icon={<Zap size={16} color={role === "player" ? c.primary : c.textFaint} />}
                    activeColor={c.primary}
                    onPress={() => setRole("player")}
                  />
                  <RoleOption
                    active={role === "owner"}
                    label="I own a court"
                    icon={<Crown size={16} color={role === "owner" ? tokens.orange500 : c.textFaint} />}
                    activeColor={tokens.orange500}
                    onPress={() => setRole("owner")}
                  />
                </View>
                <Text style={[styles.roleHint, { color: c.textMuted }]}>
                  {role === "player"
                    ? "Book courts, join open games and split the bill with your squad."
                    : "List your venue, set court hours and take booking requests in Owner Studio."}
                </Text>
              </View>

              <Field label="Your name" value={name} onChangeText={setName} placeholder="What should we call you?" error={touched ? nameError : null} />
              {sm ? (
                <View style={styles.twoCol}>
                  <View style={styles.twoColItem}>
                    <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@mail.com" keyboardType="email-address" autoCapitalize="none" error={touched ? emailError : null} />
                  </View>
                  <View style={styles.twoColItem}>
                    <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="98XXXXXXXX" keyboardType="phone-pad" autoCapitalize="none" error={touched ? phoneError : null} />
                  </View>
                </View>
              ) : (
                <>
                  <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@mail.com" keyboardType="email-address" autoCapitalize="none" error={touched ? emailError : null} />
                  <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="98XXXXXXXX" keyboardType="phone-pad" autoCapitalize="none" error={touched ? phoneError : null} />
                </>
              )}
              <Text style={[styles.fieldHint, { color: c.textFaint }]}>
                One account per phone number — it is how a booking finds you. We email your booking
                confirmations and a reminder before kick-off.
              </Text>

              <View style={styles.fieldBlock}>
                <Label style={styles.labelFlush}>Pick a password (min 6 chars)</Label>
                <TextControl
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Something you&apos;ll remember"
                  icon={<Lock size={16} color={c.textFaint} />}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="newPassword"
                  maxLength={100}
                  error={Boolean(touched && passwordError)}
                  accessibilityLabel="Password"
                  right={
                    <Pressable onPress={() => setShowPw((v) => !v)} accessibilityLabel={showPw ? "Hide password" : "Show password"}>
                      {showPw ? <EyeOff size={17} color={c.textFaint} /> : <Eye size={17} color={c.textFaint} />}
                    </Pressable>
                  }
                />
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
                {touched && passwordError ? <Text style={[styles.error, { color: c.dangerText }]}>{passwordError}</Text> : null}
              </View>

              <View style={styles.fieldBlock}>
                <Label style={styles.labelFlush}>Home city 🏠 — your search starts here</Label>
                <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: touched && cityError ? c.dangerText : c.border }]}>
                  <Picker selectedValue={defaultCity} onValueChange={(v) => setDefaultCity(String(v))} style={{ color: c.text }} dropdownIconColor={c.textMuted}>
                    {CITY_OPTIONS.filter((city) => city !== "All Cities").map((city) => <Picker.Item key={city} label={city} value={city} />)}
                  </Picker>
                </View>
                {touched && cityError ? <Text style={[styles.error, { color: c.dangerText }]}>{cityError}</Text> : null}
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
                <View style={[styles.ownerNote, { backgroundColor: c.warningBg, borderColor: c.warningBorder }]}>
                  <Crown size={16} color={c.accent} />
                  <Text style={[styles.ownerNoteText, { color: c.warningText }]}>Owner accounts can list venues, add courts, manage requests, and run leagues from Owner Studio.</Text>
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

/**
 * One half of the "I want to play / I own a court" bar.
 *
 * A segmented control rather than two big cards: it reads as one choice, it
 * cannot be mistaken for two buttons, and the selected half uses the same
 * surface + accent treatment as the rest of the app's selected states.
 */
function RoleOption({ active, label, icon, activeColor, onPress }: { active: boolean; label: string; icon: React.ReactNode; activeColor: string; onPress: () => void }) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.roleOption,
        active
          ? { backgroundColor: c.surface, borderColor: activeColor }
          : { backgroundColor: "transparent", borderColor: "transparent" },
      ]}
    >
      {icon}
      <Text style={[styles.roleOptionText, { color: active ? c.text : c.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      {active ? <Check size={14} color={activeColor} strokeWidth={3.5} /> : null}
    </Pressable>
  );
}

function ChoiceRow({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string; onChange: (value: string) => void }) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.fieldBlock}>
      <Label style={styles.labelFlush}>{label}</Label>
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
  roleBlock: { gap: space[2] },
  roleBar: { flexDirection: "row", gap: space[1], borderWidth: 1, borderRadius: radius["2xl"], padding: space[1] },
  roleOption: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[2],
  },
  roleOptionText: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: "900" },
  roleHint: { fontSize: fontSize.xs, lineHeight: 17, textAlign: "center" },
  fieldBlock: { gap: space[1] },
  // `Label` carries its own bottom margin; inside a gap'd block that doubles up.
  labelFlush: { marginBottom: 0 },
  fieldHint: { fontSize: fontSize.xs, lineHeight: 17, marginTop: -space[1] },
  pickerWrap: { borderWidth: 1, borderRadius: radius["2xl"], overflow: "hidden", minHeight: 48, justifyContent: "center" },
  hint: { fontSize: fontSize.xs, fontWeight: "600" },
  error: { fontSize: fontSize.xs, fontWeight: "700" },
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
