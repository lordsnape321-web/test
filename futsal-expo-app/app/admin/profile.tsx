import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Crown, Eye, EyeOff, Lock, MapPin, Phone, User as UserIcon } from "lucide-react-native";
import { AvatarUploader } from "@/components/AvatarUploader";
import { changePassword } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
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
  const { user, updateProfile: authUpdate } = useAuth();
  const { colors: c, isDark } = useTheme();
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
