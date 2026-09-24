import * as ImagePickerLib from "expo-image-picker";
import { Check, ImagePlus, Link } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { VENUE_IMAGES } from "@/lib/futsal";
import { fontSize, radius, space } from "@/theme";

export const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;

/**
 * ImagePicker — a 1:1 port of the web app's components/ImagePicker.tsx, with
 * the file input swapped for expo-image-picker (the same seam AvatarUploader
 * uses): the picked photo becomes the identical `data:image/jpeg;base64,…`
 * string FileReader would produce. Upload, paste-a-link, and the VENUE_IMAGES
 * "pick a vibe" grid all behave exactly like the original.
 */
export function ImagePicker({
  value,
  onChange,
  label = "Photo",
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
}) {
  const { colors: c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urlMode, setUrlMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  async function pickFile() {
    setError("");
    try {
      const perm = await ImagePickerLib.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Allow photo access to pick a photo 📸");
        return;
      }
      setBusy(true);
      const res = await ImagePickerLib.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]) {
        setBusy(false);
        return;
      }
      const asset = res.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_IMAGE_BYTES) {
        setBusy(false);
        setError("Over 2.5MB — please use a smaller photo.");
        return;
      }
      onChange(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
      setBusy(false);
    } catch {
      setBusy(false);
      setError("Couldn't read that file.");
    }
  }

  return (
    <View>
      <Text style={[styles.label, { color: c.textFaint }]}>{label}</Text>
      {value ? (
        <View style={[styles.previewWrap, { borderColor: c.border }]}>
          <Image source={{ uri: value }} style={styles.preview} resizeMode="cover" />
        </View>
      ) : null}
      <View style={styles.row}>
        <Pressable
          onPress={() => void pickFile()}
          disabled={busy}
          accessibilityRole="button"
          style={[styles.uploadBtn, { borderColor: c.border }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={c.textMuted} />
          ) : (
            <ImagePlus size={16} color={c.textMuted} />
          )}
          <Text style={[styles.uploadText, { color: c.textMuted }]}>
            {busy ? "Reading…" : value ? "Change photo 📸" : "Upload photo 📸"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setUrlMode((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Paste image link"
          style={[styles.linkBtn, { borderColor: c.border }]}
        >
          <Link size={16} color={c.textMuted} />
        </Pressable>
      </View>
      {urlMode ? (
        <View style={styles.urlRow}>
          <TextInput
            value={urlDraft}
            onChangeText={setUrlDraft}
            placeholder="https://…"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.urlInput, { borderColor: c.border, color: c.text, backgroundColor: c.inset }]}
          />
          <Pressable
            onPress={() => {
              if (urlDraft.trim()) {
                onChange(urlDraft.trim());
                setUrlDraft("");
                setUrlMode(false);
              }
            }}
            accessibilityRole="button"
            style={styles.useBtn}
          >
            <Text style={styles.useBtnText}>Use</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={[styles.vibe, { color: c.textFaint }]}>…or pick a vibe ✨</Text>
      <View style={styles.grid}>
        {VENUE_IMAGES.map((u) => (
          <Pressable
            key={u}
            onPress={() => onChange(u)}
            accessibilityRole="button"
            accessibilityState={{ selected: value === u }}
            style={[
              styles.thumb,
              { borderColor: value === u ? "#10B981" : "transparent", opacity: value === u ? 1 : 0.85 },
            ]}
          >
            <Image source={{ uri: u }} style={styles.thumbImg} resizeMode="cover" />
            {value === u ? (
              <View style={styles.thumbCheck}>
                <Check size={16} color="#FFFFFF" strokeWidth={3} />
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: space["1.5"] ?? 6,
  },
  previewWrap: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: space["2"],
  },
  preview: { width: "100%", height: 128 },
  row: { flexDirection: "row", gap: space["2"] },
  uploadBtn: {
    flex: 1,
    flexDirection: "row",
    gap: space["2"],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: radius.lg,
    paddingVertical: space["3"],
  },
  uploadText: { fontSize: fontSize.xs, fontWeight: "900" },
  linkBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  urlRow: { flexDirection: "row", gap: space["2"], marginTop: space["2"] },
  urlInput: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space["3"],
    paddingVertical: space["2"],
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
  useBtn: {
    paddingHorizontal: space["3.5"] ?? 14,
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: "#0C0A09",
  },
  useBtnText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  error: { marginTop: 6, fontSize: 11, fontWeight: "700", color: "#EF4444" },
  vibe: { marginTop: space["2"], fontSize: 11, fontWeight: "700" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  thumb: {
    width: "23%",
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    borderWidth: 2,
    overflow: "hidden",
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbCheck: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(16,185,129,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
});
