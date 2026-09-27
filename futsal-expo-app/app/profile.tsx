import { Picker } from "@/components/ThemedPicker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Check,
  Eye,
  EyeOff,
  Gift,
  Lock,
  LogIn,
  MapPin,
  PartyPopper,
  Phone,
  User as UserIcon,
} from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { changePassword, fetchUserStats, fetchVouchers } from "@/api";
import { AvatarUploader } from "@/components/AvatarUploader";
import { PlayerRatingCard } from "@/components/PlayerRating";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { CITY_OPTIONS } from "@/lib/futsal";
import { monthLabel, type PlayerStats } from "@/lib/loyalty";
import type { LoyaltyProgress, User, Voucher } from "@/lib/types";
import { firstError, passwordStrength, validateName, validatePassword, validatePhone } from "@/lib/validation";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * My profile — a port of the web app's app/profile/page.tsx.
 *
 * Same sections in the same order (reliability card, loyalty rewards, your look,
 * about you, change password), same copy, same validation chain, same avatar
 * colour swatches. Two web-isms are adapted rather than copied:
 *   - the file input becomes AvatarUploader's expo-image-picker (same data-URL
 *     output), and
 *   - the violet→fuchsia voucher gradient uses expo-linear-gradient.
 *
 * The form fields are hand-rolled (not the shared <Field>) because the original
 * uses the warm inset-cream fill, a live char counter on the name, and a phone
 * icon prefix — details <Field> doesn't carry.
 */

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#f59e0b"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const POSITIONS = ["Striker", "Midfielder", "Winger", "Defender", "Goalkeeper", "Pivot", "All-rounder"];

export default function ProfileScreen() {
  const { colors: c, isDark } = useTheme();
  const { user, ready, updateProfile } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [level, setLevel] = useState("Intermediate");
  const [position, setPosition] = useState("All-rounder");
  const [color, setColor] = useState(COLORS[0]);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [defaultCity, setDefaultCity] = useState("All Cities");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [progress, setProgress] = useState<LoyaltyProgress[]>([]);
  const [progressMonth, setProgressMonth] = useState("");

  useEffect(() => {
    if (!user) return;
    const u = user as User & { avatarColor?: string; defaultCity?: string };
    setName(u.name);
    setPhone(u.phone);
    setLevel(u.level ?? "Intermediate");
    setPosition(u.position ?? "All-rounder");
    setColor(u.avatarColor ?? COLORS[0]);
    setAvatarUrl(u.avatarUrl ?? "");
    setDefaultCity(u.defaultCity ?? "All Cities");
    (async () => {
      try {
        const [s, v] = await Promise.all([fetchUserStats(u.id), fetchVouchers(u.id)]);
        if (s) setStats(s);
        setVouchers(v.vouchers);
        setProgress(v.progress);
        setProgressMonth(v.month);
      } catch {
        // Stats/vouchers are enhancement; the form works without them.
      }
    })();
  }, [user]);

  async function saveProfile() {
    if (!user) return;
    const errs: Record<string, string> = {};
    const nErr = validateName(name);
    if (nErr) errs.name = nErr;
    const pErr = validatePhone(phone, { required: true });
    if (pErr) errs.phone = pErr;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setMsg({ ok: false, text: firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏" });
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setMsg(null);
    try {
      await updateProfile({
        name: name.trim(),
        phone: phone.trim(),
        level,
        position,
        avatarUrl,
        defaultCity,
        avatarColor: color,
      } as Partial<User> & { defaultCity?: string; avatarColor?: string });
      setMsg({ ok: true, text: "Looking good! Your profile is updated. ✨" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save" });
    } finally {
      setSaving(false);
    }
  }

  async function doChangePassword() {
    if (!user) return;
    if (!currentPw) {
      setPwMsg({ ok: false, text: "Current password is required 🔒" });
      return;
    }
    const npErr = validatePassword(newPw, { label: "New password" });
    if (npErr) {
      setPwMsg({ ok: false, text: npErr });
      return;
    }
    if (currentPw === newPw) {
      setPwMsg({ ok: false, text: "New password must be different from the old one 🔄" });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    try {
      await changePassword({ userId: user.id, currentPassword: currentPw, newPassword: newPw });
      setPwMsg({ ok: true, text: "Password changed! You're all secure. 🔒" });
      setCurrentPw("");
      setNewPw("");
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't change" });
    } finally {
      setPwSaving(false);
    }
  }

  const strength = passwordStrength(newPw);
  const activeVouchers = vouchers.filter((v) => v.status === "active");
  const usedVouchers = vouchers.filter((v) => v.status !== "active");

  // Signed-out state (deep-link only in the app), matching the web page.
  if (ready && !user) {
    return (
      <SafeAreaView style={[styles.flex, styles.center, { backgroundColor: c.bg }]} edges={["top"]}>
        <View style={[styles.signedOutCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.signedOutIcon, { backgroundColor: colors.emerald600 }]}>
            <UserIcon size={32} color="#FFFFFF" />
          </View>
          <Text style={[styles.signedOutTitle, { color: c.text }]}>Your profile awaits 🌟</Text>
          <Text style={[styles.signedOutBody, { color: c.textMuted }]}>Log in to style your player card.</Text>
          <View style={styles.signedOutActions}>
            <Pressable onPress={() => router.push("/login")} style={[styles.signedOutBtn, { backgroundColor: colors.emerald600 }]}>
              <LogIn size={16} color="#FFFFFF" />
              <Text style={styles.signedOutBtnText}>Log in</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/signup")} style={[styles.signedOutBtn, { borderColor: c.border }]}>
              <Text style={[styles.signedOutBtnText, { color: c.text }]}>Join free</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const inputFill = isDark ? "rgba(255,255,255,0.05)" : colors.insetCream;
  const u = user as (User & { avatarColor?: string; matchesPlayed?: number }) | null;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.eyebrowRow}>
          <PartyPopper size={14} color={colors.orange500} />
          <Text style={styles.eyebrow}>Make it yours</Text>
        </View>
        <Text style={[styles.h1, { color: c.text }]}>My profile</Text>

        {/* Reliability */}
        {stats ? (
          <View style={styles.section}>
            <PlayerRatingCard stats={stats} />
          </View>
        ) : null}

        {/* Loyalty rewards */}
        {vouchers.length > 0 || progress.length > 0 ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.cardTitleRow}>
              <Gift size={16} color={isDark ? "#A78BFA" : "#7C3AED"} />
              <Text style={[styles.cardTitle, { color: isDark ? "#A78BFA" : "#7C3AED" }]}>Loyalty rewards 🎁</Text>
            </View>
            <Text style={[styles.cardSub, { color: c.textMuted }]}>
              Play 7 games at the same futsal in {progressMonth ? monthLabel(progressMonth) : "a month"} → earn a FREE hour! ⚽
            </Text>

            {activeVouchers.length > 0 ? (
              <View style={styles.voucherList}>
                {activeVouchers.map((v) => (
                  <LinearGradient
                    key={v.id}
                    colors={["#7C3AED", "#C026D3"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.voucher}
                  >
                    <View style={styles.voucherGift}>
                      <Text style={styles.voucherGiftEmoji}>🎁</Text>
                    </View>
                    <View style={styles.grow}>
                      <Text style={styles.voucherTitle}>FREE 1 hour at {v.venue?.name ?? "futsal"}!</Text>
                      <Text style={styles.voucherCode}>{v.code} • pick it at booking 🎉</Text>
                    </View>
                    <Pressable onPress={() => router.push("/venues")} style={styles.voucherUse}>
                      <Text style={styles.voucherUseText}>Use it →</Text>
                    </Pressable>
                  </LinearGradient>
                ))}
              </View>
            ) : null}

            {progress.length > 0 ? (
              <View style={styles.progressList}>
                {progress.map((p) => (
                  <View key={p.venueId} style={[styles.progressCard, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.stone50 }]}>
                    <View style={styles.progressHead}>
                      <Text style={[styles.progressName, { color: c.text }]} numberOfLines={1}>
                        {p.venueName}
                      </Text>
                      <Text style={[styles.progressCount, { color: p.done ? colors.emerald600 : c.textMuted }]}>
                        {p.done ? "🎉 Reward earned!" : `${p.count}/${p.target} • ${p.remaining} to go`}
                      </Text>
                    </View>
                    <View style={styles.progressBars}>
                      {Array.from({ length: p.target }).map((_, i) => (
                        <View
                          key={i}
                          style={[styles.progressBar, { backgroundColor: i < p.count ? "#8B5CF6" : isDark ? "rgba(255,255,255,0.10)" : colors.stone200 }]}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {usedVouchers.length > 0 ? (
              <Text style={[styles.usedNote, { color: c.textFaint }]}>
                Used {usedVouchers.length} free hour{usedVouchers.length !== 1 ? "s" : ""} so far — nice! 💜
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Your look */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.cardTitleRow}>
            <UserIcon size={16} color={isDark ? colors.emerald400 : colors.emerald700} />
            <Text style={[styles.cardTitle, { color: isDark ? colors.emerald400 : colors.emerald700 }]}>Your look 📸</Text>
          </View>
          <View style={styles.uploaderWrap}>
            <AvatarUploader name={name || "?"} color={color} value={avatarUrl} onChange={setAvatarUrl} />
          </View>
          <View style={[styles.summary, { borderTopColor: isDark ? "rgba(255,255,255,0.05)" : colors.stone100 }]}>
            <Text style={[styles.summaryName, { color: c.text }]} numberOfLines={1}>{name || "…"}</Text>
            <Text style={[styles.summaryEmail, { color: c.textMuted }]} numberOfLines={1}>{user?.email}</Text>
            <Text style={[styles.summaryMeta, { color: c.textFaint }]}>
              ⚽ {level} • {position} • {u?.matchesPlayed ?? 0} games played
            </Text>
          </View>
        </View>

        {/* About you */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.cardTitleRow}>
            <UserIcon size={16} color={isDark ? colors.emerald400 : colors.emerald700} />
            <Text style={[styles.cardTitle, { color: isDark ? colors.emerald400 : colors.emerald700 }]}>About you</Text>
          </View>

          <View style={styles.formFields}>
            {/* Display name */}
            <View>
              <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Display name</Text>
              <TextInput
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setFieldErrors((p) => ({ ...p, name: "" }));
                }}
                maxLength={60}
                style={[styles.input, { backgroundColor: inputFill, borderColor: fieldErrors.name ? colors.red400 : c.border, color: c.text }]}
              />
              {fieldErrors.name ? (
                <Text style={styles.fieldError}>{fieldErrors.name}</Text>
              ) : (
                <Text style={[styles.fieldHint, { color: c.textFaint }]}>{name.trim().length}/60</Text>
              )}
            </View>

            {/* Phone */}
            <View>
              <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Phone (one account per number)</Text>
              <View style={[styles.phoneWrap, { backgroundColor: inputFill, borderColor: fieldErrors.phone ? colors.red400 : c.border }]}>
                <Phone size={16} color={c.textFaint} />
                <TextInput
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t);
                    setFieldErrors((p) => ({ ...p, phone: "" }));
                  }}
                  placeholder="98XXXXXXXX"
                  placeholderTextColor={c.textFaint}
                  maxLength={16}
                  keyboardType="phone-pad"
                  style={[styles.phoneInput, { color: c.text }]}
                />
              </View>
              {fieldErrors.phone ? <Text style={styles.fieldError}>{fieldErrors.phone}</Text> : null}
            </View>

            {/* Home city */}
            <View>
              <View style={styles.fieldLabelRow}>
                <MapPin size={14} color={c.textFaint} />
                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Home city — used for futsal search 🏠</Text>
              </View>
              <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                <Picker selectedValue={defaultCity} onValueChange={setDefaultCity} style={{ color: c.text, height: 44 }} dropdownIconColor={c.textMuted}>
                  {CITY_OPTIONS.map((opt) => (
                    <Picker.Item key={opt} label={opt === "All Cities" ? "No default — show all cities" : opt} value={opt} />
                  ))}
                </Picker>
              </View>
              <Text style={[styles.fieldHint, { color: c.textFaint }]}>
                Home tab search starts in {defaultCity === "All Cities" ? "all cities 🌍" : `${defaultCity} 📍`} — change anytime!
              </Text>
            </View>

            {/* Level + Position */}
            <View style={styles.twoCol}>
              <View style={styles.grow}>
                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Level</Text>
                <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                  <Picker selectedValue={level} onValueChange={setLevel} style={{ color: c.text, height: 44 }} dropdownIconColor={c.textMuted}>
                    {LEVELS.map((l) => (
                      <Picker.Item key={l} label={l} value={l} />
                    ))}
                  </Picker>
                </View>
              </View>
              <View style={styles.grow}>
                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Position</Text>
                <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                  <Picker selectedValue={position} onValueChange={setPosition} style={{ color: c.text, height: 44 }} dropdownIconColor={c.textMuted}>
                    {POSITIONS.map((p) => (
                      <Picker.Item key={p} label={p} value={p} />
                    ))}
                  </Picker>
                </View>
              </View>
            </View>

            {/* Avatar colour */}
            <View>
              <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Avatar colour (backup if no photo)</Text>
              <View style={styles.swatches}>
                {COLORS.map((sw) => (
                  <Pressable
                    key={sw}
                    onPress={() => setColor(sw)}
                    accessibilityRole="button"
                    accessibilityLabel={sw}
                    style={[styles.swatch, { backgroundColor: sw }, color === sw ? { borderColor: colors.emerald500 } : null]}
                  >
                    {color === sw ? <Check size={16} color="#FFFFFF" strokeWidth={3} /> : null}
                  </Pressable>
                ))}
              </View>
            </View>

            {msg ? (
              <Text style={[styles.banner, msg.ok ? { backgroundColor: colors.emerald50, color: colors.emerald700 } : { backgroundColor: colors.red50, color: colors.red600 }]}>
                {msg.text}
              </Text>
            ) : null}

            <Pressable onPress={() => void saveProfile()} disabled={saving} style={[styles.saveBtn, { backgroundColor: colors.emerald600 }, saving ? styles.dim : null]}>
              <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save my style ✨"}</Text>
            </Pressable>
          </View>
        </View>

        {/* Change password */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.cardTitleRow}>
            <Lock size={16} color={colors.orange500} />
            <Text style={[styles.cardTitle, { color: colors.orange500 }]}>Change password</Text>
          </View>

          <View style={styles.formFields}>
            <View>
              <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Current password</Text>
              <TextInput
                value={currentPw}
                onChangeText={setCurrentPw}
                secureTextEntry={!showPw}
                placeholder="••••••••"
                placeholderTextColor={c.textFaint}
                autoCapitalize="none"
                style={[styles.input, { backgroundColor: inputFill, borderColor: c.border, color: c.text }]}
              />
            </View>

            <View>
              <Text style={[styles.fieldLabel, { color: c.textFaint }]}>New password</Text>
              <View style={[styles.pwWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                <TextInput
                  value={newPw}
                  onChangeText={setNewPw}
                  secureTextEntry={!showPw}
                  placeholder="Min 6 characters"
                  placeholderTextColor={c.textFaint}
                  maxLength={100}
                  autoCapitalize="none"
                  style={[styles.pwInput, { color: c.text }]}
                />
                <Pressable onPress={() => setShowPw((v) => !v)} accessibilityRole="button" accessibilityLabel={showPw ? "Hide password" : "Show password"}>
                  {showPw ? <EyeOff size={16} color={c.textFaint} /> : <Eye size={16} color={c.textFaint} />}
                </Pressable>
              </View>
              {newPw ? (
                <View style={styles.strengthWrap}>
                  <View style={styles.strengthBars}>
                    {[1, 2, 3, 4].map((i) => (
                      <View
                        key={i}
                        style={[
                          styles.strengthBar,
                          {
                            backgroundColor:
                              i <= strength.score
                                ? strength.score <= 1
                                  ? colors.red400
                                  : strength.score === 2
                                    ? colors.amber400
                                    : colors.emerald500
                                : isDark
                                  ? "rgba(255,255,255,0.10)"
                                  : colors.stone200,
                          },
                        ]}
                      />
                    ))}
                  </View>
                  <Text style={[styles.strengthLabel, { color: c.textMuted }]}>
                    {strength.emoji} {strength.label}
                    {strength.tips.length > 0 && newPw.length >= 6 ? ` • try: ${strength.tips.slice(0, 2).join(", ")}` : ""}
                  </Text>
                </View>
              ) : null}
            </View>

            {pwMsg ? (
              <Text style={[styles.banner, pwMsg.ok ? { backgroundColor: colors.emerald50, color: colors.emerald700 } : { backgroundColor: colors.red50, color: colors.red600 }]}>
                {pwMsg.text}
              </Text>
            ) : null}

            <Pressable
              onPress={() => void doChangePassword()}
              disabled={pwSaving || !currentPw || !newPw}
              style={[styles.saveBtn, { backgroundColor: colors.orange500 }, pwSaving || !currentPw || !newPw ? styles.dim : null]}
            >
              <Text style={styles.saveBtnText}>{pwSaving ? "Updating…" : "Update password 🔒"}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center", padding: space[4] },
  content: { padding: space[4], paddingBottom: space[16] },
  section: { marginTop: space[5] },

  /* Signed-out */
  signedOutCard: { width: "100%", maxWidth: 420, borderRadius: radius["3xl"], borderWidth: 1, padding: space[8], alignItems: "center" },
  signedOutIcon: { width: 64, height: 64, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center" },
  signedOutTitle: { fontSize: fontSize["2xl"], fontWeight: "900", marginTop: space[4], textAlign: "center" },
  signedOutBody: { fontSize: fontSize.base, marginTop: space[2], textAlign: "center" },
  signedOutActions: { flexDirection: "row", gap: space[2], marginTop: space[6], alignSelf: "stretch" },
  signedOutBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2], borderRadius: radius["2xl"], borderWidth: 1, borderColor: "transparent", paddingVertical: space[3] },
  signedOutBtnText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },

  /* Header */
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: { fontSize: fontSize.xs, fontWeight: "900", textTransform: "uppercase", letterSpacing: 2, color: colors.orange500 },
  h1: { fontSize: fontSize["3xl"], fontWeight: "900", marginTop: 2 },

  /* Cards */
  card: { borderRadius: radius["3xl"], borderWidth: 1, padding: space[5], marginTop: space[4] },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  cardTitle: { fontSize: fontSize.base, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.5 },
  cardSub: { fontSize: fontSize.xs, marginTop: space[1] },

  /* Vouchers */
  voucherList: { gap: space[2], marginTop: space[3] },
  voucher: { flexDirection: "row", alignItems: "center", gap: space[3], borderRadius: radius["2xl"], padding: 14 },
  voucherGift: { width: 44, height: 44, borderRadius: radius.xl, backgroundColor: "rgba(255,255,255,0.20)", alignItems: "center", justifyContent: "center" },
  voucherGiftEmoji: { fontSize: 22 },
  voucherTitle: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  voucherCode: { fontSize: fontSize.xs, color: "rgba(255,255,255,0.80)", marginTop: 2 },
  voucherUse: { borderRadius: radius.full, backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: space[2] },
  voucherUseText: { fontSize: fontSize.xs, fontWeight: "900", color: "#7C3AED" },

  /* Progress */
  progressList: { gap: space[2.5], marginTop: space[3] },
  progressCard: { borderRadius: radius["2xl"], padding: space[3] },
  progressHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  progressName: { fontSize: fontSize.xs, fontWeight: "900", flex: 1 },
  progressCount: { fontSize: fontSize.xs, fontWeight: "900" },
  progressBars: { flexDirection: "row", gap: 4, marginTop: 6 },
  progressBar: { flex: 1, height: 10, borderRadius: radius.full },
  usedNote: { fontSize: fontSize.xs, marginTop: space[2] },

  /* Your look */
  uploaderWrap: { marginTop: space[3] },
  summary: { marginTop: space[4], borderTopWidth: 1, paddingTop: space[3] },
  summaryName: { fontSize: fontSize["2xl"], fontWeight: "900" },
  summaryEmail: { fontSize: fontSize.base, marginTop: 2 },
  summaryMeta: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 2 },

  /* Form */
  formFields: { gap: space[3], marginTop: space[3] },
  fieldLabel: { fontSize: fontSize.xs, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 10, fontSize: fontSize.base, fontWeight: "600", minHeight: 44 },
  phoneWrap: { flexDirection: "row", alignItems: "center", gap: space[2], borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: space[4] },
  phoneInput: { flex: 1, paddingVertical: 10, fontSize: fontSize.base, fontWeight: "600" },
  pickerWrap: { borderWidth: 1, borderRadius: radius.xl, overflow: "hidden" },
  twoCol: { flexDirection: "row", gap: space[3] },
  fieldError: { fontSize: fontSize.xs, fontWeight: "700", color: colors.red500, marginTop: 4 },
  fieldHint: { fontSize: fontSize.xs, marginTop: 4 },

  /* Swatches */
  swatches: { flexDirection: "row", gap: space[2] },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },

  /* Password strength */
  pwWrap: { flexDirection: "row", alignItems: "center", gap: space[2], borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: 14 },
  pwInput: { flex: 1, paddingVertical: 10, fontSize: fontSize.base, fontWeight: "600" },
  strengthWrap: { marginTop: 6 },
  strengthBars: { flexDirection: "row", gap: 4 },
  strengthBar: { flex: 1, height: 6, borderRadius: radius.full },
  strengthLabel: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 4 },

  /* Actions */
  banner: { borderRadius: radius.xl, paddingHorizontal: space[4], paddingVertical: space[3], fontSize: fontSize.xs, fontWeight: "700" },
  saveBtn: { borderRadius: radius["2xl"], paddingVertical: space[3], alignItems: "center", justifyContent: "center" },
  saveBtnText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  dim: { opacity: 0.5 },
});
