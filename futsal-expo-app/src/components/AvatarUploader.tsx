import * as ImagePicker from "expo-image-picker";
import { Camera, Link2, Trash2 } from "lucide-react-native";
import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { initials } from "@/lib/futsal";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * AvatarUploader — a port of the web app's components/AvatarUploader.tsx.
 *
 * Same three affordances as the original: pick a photo, paste an image URL, or
 * remove the current one. The one thing that cannot port verbatim is the file
 * input: the web reads a picked File into a data URL with FileReader, whereas
 * native has no <input type="file">, so this uses expo-image-picker and builds
 * the same `data:image/jpeg;base64,…` string from the returned asset. Both paths
 * produce a data URL stored in avatarUrl, so the value shape is identical.
 *
 * The 2.5MB ceiling (MAX_AVATAR_BYTES) and the https-link validation match the
 * original exactly.
 */

export const MAX_AVATAR_BYTES = 2.5 * 1024 * 1024;

export function AvatarUploader({
  name,
  color,
  value,
  onChange,
}: {
  name: string;
  color: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const { colors: c, isDark } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urlMode, setUrlMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  async function pickPhoto() {
    setError("");
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Allow photo access to pick a selfie 📸");
        return;
      }
      setBusy(true);
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]) {
        setBusy(false);
        return;
      }
      const asset = res.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
        setBusy(false);
        setError("Over 2.5MB — use a smaller selfie 📸");
        return;
      }
      // Match the web's FileReader output: a JPEG data URL.
      onChange(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
      setBusy(false);
    } catch {
      setBusy(false);
      setError("Couldn't read that photo — try another 📸");
    }
  }

  function applyUrl() {
    const draft = urlDraft.trim();
    if (!draft) return;
    if (!/^https?:\/\/.+\..+/.test(draft)) {
      setError("Paste a valid https image link 🔗");
      return;
    }
    onChange(draft);
    setUrlDraft("");
    setUrlMode(false);
    setError("");
  }

  const darkPill = isDark ? { backgroundColor: colors.white } : { backgroundColor: colors.stone900 };
  const darkPillText = isDark ? colors.slate900 : colors.white;

  return (
    <View style={styles.row}>
      {/* Photo tile — tap to pick */}
      <Pressable
        onPress={() => void pickPhoto()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Upload profile photo"
        style={[styles.tile, { backgroundColor: color }]}
      >
        {value ? (
          <Image source={{ uri: value }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text style={styles.tileInitials}>{initials(name || "?")}</Text>
        )}
        <View style={styles.tileBadge}>
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Camera size={13} color="#FFFFFF" />
          )}
        </View>
      </Pressable>

      <View style={styles.grow}>
        <View style={styles.actions}>
          <Pressable
            onPress={() => void pickPhoto()}
            disabled={busy}
            style={[styles.pill, darkPill]}
          >
            <Text style={[styles.pillText, { color: darkPillText }]}>
              {busy ? "Reading…" : value ? "Change photo 📸" : "Upload photo 📸"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setUrlMode((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Paste image link"
            style={[styles.iconBtn, { borderColor: c.border }]}
          >
            <Link2 size={14} color={c.textMuted} />
          </Pressable>

          {value ? (
            <Pressable
              onPress={() => onChange("")}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              style={[styles.iconBtn, { borderColor: colors.red200, backgroundColor: colors.red50 }]}
            >
              <Trash2 size={14} color={colors.red500} />
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.hint, { color: c.textFaint }]}>
          JPG/PNG up to 2.5MB — teammates see this everywhere ⚽
        </Text>

        {urlMode ? (
          <View style={styles.urlRow}>
            <TextInput
              value={urlDraft}
              onChangeText={setUrlDraft}
              placeholder="https://…"
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.urlInput, { borderColor: c.border, color: c.text }]}
            />
            <Pressable onPress={applyUrl} style={[styles.urlUse, darkPill]}>
              <Text style={[styles.urlUseText, { color: darkPillText }]}>Use</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space[4] },
  grow: { flex: 1, minWidth: 0 },

  tile: { width: 80, height: 80, borderRadius: radius["3xl"], overflow: "hidden", alignItems: "center", justifyContent: "center" },
  tileInitials: { fontSize: 28, fontWeight: "900", color: "#FFFFFF" },
  tileBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },

  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  pill: { borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: space[2] },
  pillText: { fontSize: fontSize.xs, fontWeight: "900" },
  iconBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  hint: { fontSize: fontSize.xs, lineHeight: 15, marginTop: 6 },
  urlRow: { flexDirection: "row", gap: space[2], marginTop: space[2] },
  urlInput: { flex: 1, borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: space[3], paddingVertical: space[2], fontSize: fontSize.xs, fontWeight: "600" },
  urlUse: { borderRadius: radius.xl, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  urlUseText: { fontSize: fontSize.xs, fontWeight: "900" },
  error: { fontSize: fontSize.xs, fontWeight: "700", color: colors.red500, marginTop: 6 },
});
