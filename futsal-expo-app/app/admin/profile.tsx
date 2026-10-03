import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AlertTriangle,
  ChevronRight,
  Crown,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MapPin,
  Phone,
  User as UserIcon,
  X,
} from "lucide-react-native";
import { AvatarUploader } from "@/components/AvatarUploader";
import { changePassword, deleteAccount, requestAccountDeleteCode } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import { CITY_OPTIONS } from "@/lib/futsal";
import { passwordStrength, validateName, validatePassword, validatePhone, firstError } from "@/lib/validation";
import { colors, fontSize, radius, space } from "@/theme";
import { Picker } from "@/components/ThemedPicker";

const COLORS = [
  "#16a34a",
  "#2563eb",
  "#dc2626",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
  "#be123c",
  "#f59e0b",
];

/** Owner Studio → My profile — identity form + change password (admin/profile). */
export default function OwnerProfile() {
  const { user, updateProfile: authUpdate, signOut } = useAuth();
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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

  // Closing the account — the same emailed-code flow the player app offers in
  // Settings, so an owner is not locked into a studio they cannot leave.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (user) {
      const u = user as typeof user & { avatarColor?: string; avatarUrl?: string; defaultCity?: string };
      setName(user.name);
      setPhone(user.phone);
      setColor(u.avatarColor ?? COLORS[0]);
      setAvatarUrl(u.avatarUrl ?? "");
      setDefaultCity(u.defaultCity ?? "All Cities");
    }
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
      setMsg({
        ok: false,
        text: firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏",
      });
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setMsg(null);
    try {
      // AuthContext.updateProfile already calls PATCH /api/users/:id and
      // refreshes the session — same path the web UserProvider uses.
      await authUpdate({
        name: name.trim(),
        phone: phone.trim(),
        avatarColor: color,
        avatarUrl,
        defaultCity,
      } as Partial<typeof user>);
      setMsg({ ok: true, text: "Profile updated! Players will see the new you. ✨" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save" });
    } finally {
      setSaving(false);
    }
  }

  async function savePassword() {
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
      setPwMsg({ ok: true, text: "Password changed! Your studio stays safe. 🔒" });
      setCurrentPw("");
      setNewPw("");
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't change" });
    } finally {
      setPwSaving(false);
    }
  }

  /** Email the delete code to the address on the account (never one typed here). */
  async function askDeleteCode() {
    if (!user) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      const { email } = await requestAccountDeleteCode(user.id);
      setDeleteKey(email);
    } catch (e) {
      setDeleteErr(e instanceof ApiError ? e.message : "Could not send the code. Try again shortly.");
    } finally {
      setDeleteBusy(false);
    }
  }

  /** Verify the code, close the account, then sign this device out for good. */
  async function confirmDelete() {
    if (!user) return;
    if (!/^\d{6}$/.test(deleteCode.trim())) {
      setDeleteErr("Enter the 6-digit code from your email ✉️");
      return;
    }

    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await deleteAccount(user.id, deleteCode.trim());
      // The account is closed server-side; clearing the session here is what
      // stops the app from flashing restored screens it should not show again.
      await signOut();
      router.replace("/login");
    } catch (e) {
      setDeleteErr(e instanceof ApiError ? e.message : "Could not close the account. Try again shortly.");
      setDeleteBusy(false);
    }
  }

  const strength = passwordStrength(newPw);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.titleRow}>
        <Crown size={22} color={colors.amber400} />
        <Text style={[styles.h1, { color: c.text }]}>My profile</Text>
      </View>
      <Text style={[styles.sub, { color: c.textMuted }]}>
        How players and your team see you across Owner Studio.
      </Text>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <AvatarUploader name={name || "?"} color={color} value={avatarUrl} onChange={setAvatarUrl} />
        <View style={[styles.identity, { borderTopColor: c.border }]}>
          <Text style={[styles.identityName, { color: c.text }]} numberOfLines={1}>
            {name || "…"}
          </Text>
          <Text style={[styles.identityEmail, { color: c.textMuted }]} numberOfLines={1}>
            {user?.email}
          </Text>
          <Text style={[styles.identityMeta, { color: c.textFaint }]}>
            👑 Venue Owner • {phone || "no phone yet"} • 📍 {defaultCity}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.titleRow}>
            <UserIcon size={16} color={colors.emerald600} />
            <Text style={[styles.cardTitle, { color: c.text }]}>Studio identity</Text>
          </View>

          <Text style={[styles.label, { color: c.textFaint }]}>Display name</Text>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              setFieldErrors((p) => ({ ...p, name: "" }));
            }}
            maxLength={60}
            style={[
              styles.input,
              {
                backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
                borderColor: fieldErrors.name ? "#F87171" : c.border,
                color: c.text,
              },
            ]}
          />
          {fieldErrors.name ? <Text style={styles.fieldErr}>{fieldErrors.name}</Text> : null}

          <Text style={[styles.label, { color: c.textFaint }]}>Phone (one account per number)</Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
                borderColor: fieldErrors.phone ? "#F87171" : c.border,
              },
            ]}
          >
            <Phone size={16} color="#38BDF8" />
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
              style={[styles.inputInline, { color: c.text }]}
            />
          </View>
          {fieldErrors.phone ? <Text style={styles.fieldErr}>{fieldErrors.phone}</Text> : null}

          <Text style={[styles.label, { color: c.textFaint }]}>Home city 🏠</Text>
          <View style={[styles.pickerWrap, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#FFFFFF" }]}>
            <Picker
              selectedValue={defaultCity}
              onValueChange={(v) => setDefaultCity(String(v))}
              style={{ color: c.text, height: 44 }}
              dropdownIconColor={c.textMuted}
            >
              {CITY_OPTIONS.map((city) => (
                <Picker.Item
                  key={city}
                  label={city === "All Cities" ? "No default — show all cities" : city}
                  value={city}
                />
              ))}
            </Picker>
          </View>

          <Text style={[styles.label, { color: c.textFaint }]}>
            Avatar colour (backup if no photo)
          </Text>
          <View style={styles.colorRow}>
            {COLORS.map((col) => (
              <Pressable
                key={col}
                onPress={() => setColor(col)}
                accessibilityLabel={col}
                style={[
                  styles.colorDot,
                  { backgroundColor: col, borderWidth: color === col ? 3 : 0, borderColor: isDark ? "#FFFFFF" : "#0F172A" },
                ]}
              />
            ))}
          </View>

          {msg ? (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: msg.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                },
              ]}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: msg.ok ? "#047857" : "#DC2626" }}>
                {msg.text}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void saveProfile()}
            disabled={saving}
            style={[styles.primaryBtn, { opacity: saving ? 0.5 : 1 }]}
          >
            {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
            <Text style={styles.primaryBtnText}>{saving ? "Saving…" : "Save changes ✨"}</Text>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.titleRow}>
            <Lock size={16} color={colors.orange500} />
            <Text style={[styles.cardTitle, { color: c.text }]}>Change password</Text>
          </View>

          <Text style={[styles.label, { color: c.textFaint }]}>Current password</Text>
          <View style={[styles.inputRow, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#FFFFFF" }]}>
            <TextInput
              value={currentPw}
              onChangeText={setCurrentPw}
              placeholder="••••••••"
              placeholderTextColor={c.textFaint}
              secureTextEntry={!showPw}
              style={[styles.inputInline, { color: c.text }]}
            />
            <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8}>
              {showPw ? <EyeOff size={16} color={c.textFaint} /> : <Eye size={16} color={c.textFaint} />}
            </Pressable>
          </View>

          <Text style={[styles.label, { color: c.textFaint }]}>New password</Text>
          <View style={[styles.inputRow, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#FFFFFF" }]}>
            <TextInput
              value={newPw}
              onChangeText={setNewPw}
              placeholder="Min 6 characters"
              placeholderTextColor={c.textFaint}
              secureTextEntry={!showPw}
              maxLength={100}
              style={[styles.inputInline, { color: c.text }]}
            />
            <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8}>
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
                              ? "#F87171"
                              : strength.score === 2
                                ? "#FBBF24"
                                : "#10B981"
                            : isDark
                              ? "rgba(255,255,255,0.1)"
                              : "#E2E8F0",
                      },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.strengthLabel, { color: c.textFaint }]}>
                {strength.emoji} {strength.label}
              </Text>
            </View>
          ) : null}

          {pwMsg ? (
            <View
              style={[
                styles.banner,
                { backgroundColor: pwMsg.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)" },
              ]}
            >
              <Text
                style={{ fontSize: 12, fontWeight: "700", color: pwMsg.ok ? "#047857" : "#DC2626" }}
              >
                {pwMsg.text}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void savePassword()}
            disabled={pwSaving || !currentPw || !newPw}
            style={[
              styles.primaryBtn,
              { backgroundColor: colors.orange500, opacity: pwSaving || !currentPw || !newPw ? 0.4 : 1 },
            ]}
          >
            <Text style={styles.primaryBtnText}>
              {pwSaving ? "Updating…" : "Update password 🔒"}
            </Text>
          </Pressable>
        </View>

        {/* ---------- CLOSE THE ACCOUNT ---------- */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.titleRow}>
            <AlertTriangle size={16} color={colors.red600} />
            <Text style={[styles.cardTitle, { color: colors.red600 }]}>Close the account</Text>
          </View>

          {!deleteOpen ? (
            <Pressable
              onPress={() => {
                setDeleteOpen(true);
                setDeleteErr(null);
                setDeleteCode("");
                setDeleteKey(null);
              }}
              accessibilityRole="button"
              style={[styles.deleteRow, { borderColor: c.border }]}
            >
              <AlertTriangle size={16} color={colors.red600} />
              <View style={styles.grow}>
                <Text style={[styles.deleteRowTitle, { color: colors.red600 }]}>
                  Delete my account
                </Text>
                <Text style={[styles.deleteRowSub, { color: c.textMuted }]} numberOfLines={2}>
                  Closes the account for good, after a code we email you. Your venues are retired.
                </Text>
              </View>
              <ChevronRight size={16} color={c.textFaint} />
            </Pressable>
          ) : (
            <View
              style={[
                styles.deleteCard,
                { borderColor: "rgba(239,68,68,0.45)", backgroundColor: "rgba(239,68,68,0.08)" },
              ]}
            >
              <View style={styles.deleteHead}>
                <AlertTriangle size={18} color={colors.red600} />
                <Text style={[styles.deleteTitle, { color: colors.red600 }]}>Close this account?</Text>
                <Pressable
                  onPress={() => setDeleteOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel deleting my account"
                  hitSlop={8}
                >
                  <X size={18} color={colors.red600} />
                </Pressable>
              </View>

              <Text style={[styles.deleteBody, { color: c.text }]}>
                This can&apos;t be undone. The venues you run are retired — their courts stop taking
                bookings and requests still waiting are withdrawn — pending bookings and open
                requests are cancelled, and the account can never be signed into again. Past
                bookings and payments stay on record with no name attached.
              </Text>

              {deleteKey ? (
                <>
                  <Text style={[styles.deleteBody, { color: c.text }]}>
                    We emailed a 6-digit code to {deleteKey}. It expires in 15 minutes.
                  </Text>
                  <Text style={[styles.label, { color: c.textFaint, marginTop: 0 }]}>
                    Code from your email
                  </Text>
                  <View
                    style={[
                      styles.inputRow,
                      {
                        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
                        borderColor: deleteErr ? "#F87171" : c.border,
                      },
                    ]}
                  >
                    <Mail size={16} color={c.textFaint} />
                    <TextInput
                      value={deleteCode}
                      onChangeText={(t) => {
                        setDeleteCode(t.replace(/\D/g, "").slice(0, 6));
                        setDeleteErr(null);
                      }}
                      placeholder="000000"
                      placeholderTextColor={c.textFaint}
                      keyboardType="number-pad"
                      maxLength={6}
                      style={[styles.inputInline, { color: c.text }]}
                      accessibilityLabel="Account deletion code"
                    />
                  </View>
                  {deleteErr ? <Text style={styles.fieldErr}>{deleteErr}</Text> : null}
                  <Pressable
                    onPress={() => void confirmDelete()}
                    disabled={deleteBusy}
                    style={[styles.dangerBtn, deleteBusy ? styles.dim : null]}
                  >
                    <Text style={styles.primaryBtnText}>
                      {deleteBusy ? "Closing your account…" : "Delete my account permanently"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void askDeleteCode()}
                    disabled={deleteBusy}
                    accessibilityRole="button"
                    style={styles.deleteResend}
                  >
                    <Text style={[styles.deleteResendText, { color: colors.red600 }]}>
                      Send a new code
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  {deleteErr ? <Text style={styles.fieldErr}>{deleteErr}</Text> : null}
                  <Pressable
                    onPress={() => void askDeleteCode()}
                    disabled={deleteBusy}
                    style={[styles.dangerBtn, deleteBusy ? styles.dim : null]}
                  >
                    <Text style={styles.primaryBtnText}>
                      {deleteBusy ? "Sending the code…" : "Email me the code ✉️"}
                    </Text>
                  </Pressable>
                  <Text style={[styles.deleteFine, { color: c.textMuted }]}>
                    The code goes to the address on this account — the one shown above.
                  </Text>
                </>
              )}

              <Pressable
                onPress={() => {
                  setDeleteOpen(false);
                  setDeleteCode("");
                  setDeleteErr(null);
                  setDeleteKey(null);
                }}
                accessibilityRole="button"
                style={styles.deleteResend}
              >
                <Text style={[styles.deleteResendText, { color: c.textMuted }]}>
                  Keep my account
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[2] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  h1: { fontSize: fontSize["2xl"], fontWeight: "900" },
  sub: { fontSize: fontSize.sm },
  card: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[5],
    marginTop: space[3],
    gap: space[2],
  },
  identity: { borderTopWidth: 1, paddingTop: space[3], marginTop: space[2] },
  identityName: { fontSize: fontSize.xl, fontWeight: "900" },
  identityEmail: { fontSize: fontSize.sm },
  identityMeta: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 2 },
  grid: { gap: 0 },
  cardTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  label: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: space[2],
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    fontSize: fontSize.sm,
    fontWeight: "600",
    minHeight: 44,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[3.5],
    minHeight: 44,
  },
  inputInline: { flex: 1, fontSize: fontSize.sm, fontWeight: "600", paddingVertical: space[2.5] },
  pickerWrap: { borderWidth: 1, borderRadius: radius.xl, overflow: "hidden", marginTop: 2 },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  grow: { flex: 1 },
  dim: { opacity: 0.5 },
  deleteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[3.5],
    paddingVertical: space[3],
    marginTop: space[1],
  },
  deleteRowTitle: { fontSize: fontSize.sm, fontWeight: "900" },
  deleteRowSub: { fontSize: fontSize.xs, lineHeight: 16, marginTop: 2 },
  deleteCard: {
    gap: space[3],
    borderWidth: 1.5,
    borderRadius: radius.xl,
    padding: space[3.5],
    marginTop: space[1],
  },
  deleteHead: { flexDirection: "row", alignItems: "center", gap: space[2] },
  deleteTitle: { flex: 1, fontSize: fontSize.base, fontWeight: "900" },
  deleteBody: { fontSize: fontSize.sm, lineHeight: 19 },
  deleteResend: { alignSelf: "center", paddingVertical: space[1] },
  deleteResendText: { fontSize: fontSize.sm, fontWeight: "800" },
  deleteFine: { fontSize: fontSize.xs, lineHeight: 16, textAlign: "center" },
  dangerBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
    backgroundColor: colors.red600,
    paddingVertical: space[3],
    minHeight: 44,
    marginTop: space[1],
  },
  fieldErr: { fontSize: 11, fontWeight: "700", color: "#EF4444", marginTop: 2 },
  banner: { borderRadius: radius.xl, padding: space[3], marginTop: space[2] },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.xl,
    backgroundColor: "#0F172A",
    paddingVertical: space[3],
    marginTop: space[2],
    minHeight: 44,
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  strengthWrap: { marginTop: space[1.5], gap: 4 },
  strengthBars: { flexDirection: "row", gap: 4 },
  strengthBar: { flex: 1, height: 6, borderRadius: 3 },
  strengthLabel: { fontSize: 11, fontWeight: "700" },
});
