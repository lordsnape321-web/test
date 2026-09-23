import * as ImagePickerLib from "expo-image-picker";
import { Eye, ReceiptText, Upload, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { fontSize, radius, space } from "@/theme";
import { MAX_IMAGE_BYTES } from "./ImagePicker";

export const ONLINE_METHODS = ["eSewa", "Khalti"];
export const MAX_RECEIPT_BYTES = 2.5 * 1024 * 1024;

export function isOnlineMethod(method: string) {
  return ONLINE_METHODS.includes(method);
}

/**
 * ReceiptUploader — a 1:1 port of the web app's components/ReceiptUploader.tsx.
 * The `<input type="file">` seam is the same one AvatarUploader established:
 * expo-image-picker reads the screenshot into a `data:image/jpeg;base64,…`
 * string, so the value shape (and the 2.5MB ceiling) match the original.
 */
export function ReceiptUploader({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  compact?: boolean;
}) {
  const { colors: c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);

  async function pickFile() {
    setError("");
    try {
      const perm = await ImagePickerLib.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Allow photo access to attach a screenshot 📸");
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
      if (asset.fileSize && asset.fileSize > MAX_RECEIPT_BYTES) {
        setBusy(false);
        setError("That file is over 2.5MB — please use a smaller screenshot.");
        return;
      }
      setBusy(false);
      onChange(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
    } catch {
      setBusy(false);
      setError("Couldn't read that file — try another one.");
    }
  }

  if (value) {
    return (
      <View>
        <View style={[styles.attached, { backgroundColor: "rgba(16,185,129,0.10)" }]}>
          <Pressable onPress={() => setPreview(true)} accessibilityRole="button">
            <Image source={{ uri: value }} style={styles.thumb} resizeMode="cover" />
          </Pressable>
          <View style={styles.grow}>
            <View style={styles.attachedTitleRow}>
              <ReceiptText size={14} color={c.primary} />
              <Text style={[styles.attachedTitle, { color: c.primary }]}>Receipt attached ✓</Text>
            </View>
            <Text style={[styles.attachedSub, { color: c.textMuted }]}>
              The venue can see this for fast approval.
            </Text>
          </View>
          <Pressable
            onPress={() => setPreview(true)}
            accessibilityRole="button"
            accessibilityLabel="View"
            style={[styles.iconBtn, { backgroundColor: c.inset }]}
          >
            <Eye size={16} color={c.textMuted} />
          </Pressable>
          <Pressable
            onPress={() => onChange("")}
            accessibilityRole="button"
            accessibilityLabel="Remove"
            style={[styles.iconBtn, { backgroundColor: c.inset }]}
          >
            <X size={16} color="#EF4444" />
          </Pressable>
        </View>
        {preview ? <ReceiptViewer url={value} onClose={() => setPreview(false)} /> : null}
      </View>
    );
  }

  return (
    <View>
      <Pressable
        onPress={() => void pickFile()}
        disabled={busy}
        accessibilityRole="button"
        style={[
          styles.upload,
          {
            borderColor: "#FB923C",
            backgroundColor: "rgba(251,146,60,0.10)",
            paddingVertical: compact ? 10 : 14,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#EA580C" />
        ) : (
          <Upload size={16} color="#EA580C" />
        )}
        <Text style={[styles.uploadText, { color: "#EA580C", fontSize: compact ? 12 : 14 }]}>
          {busy ? "Reading…" : "Upload payment screenshot 🧾"}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!compact ? (
        <Text style={[styles.hint, { color: c.textFaint }]}>
          Paid online? Snap your eSewa / Khalti confirmation — venues approve receipt-backed
          requests way faster. ⚡
        </Text>
      ) : null}
    </View>
  );
}

export function ReceiptViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const { colors: c } = useTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewerBackdrop} onPress={onClose}>
        <View style={[styles.viewerCard, { backgroundColor: c.surface }]}>
          <View style={styles.viewerHeader}>
          <View style={styles.viewerTitleRow}>
            <ReceiptText size={16} color={c.primary} />
            <Text style={[styles.viewerTitle, { color: c.text }]}>Payment receipt</Text>
          </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.closeBtn, { backgroundColor: c.inset }]}
            >
              <X size={18} color={c.textMuted} />
            </Pressable>
          </View>
          <Image source={{ uri: url }} style={styles.viewerImage} resizeMode="contain" />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  attached: {
    flexDirection: "row",
    alignItems: "center",
    gap: space["3"],
    borderRadius: radius.lg,
    padding: space["2.5"] ?? 10,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  grow: { flex: 1, minWidth: 0 },
  attachedTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  attachedTitle: { fontSize: 12, fontWeight: "900" },
  attachedSub: { fontSize: 11, marginTop: 2 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  upload: {
    flexDirection: "row",
    gap: space["2"],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: "dashed",
  },
  uploadText: { fontWeight: "900" },
  error: { marginTop: 6, fontSize: 11, fontWeight: "700", color: "#EF4444" },
  hint: { marginTop: 6, fontSize: 11, lineHeight: 16 },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: space["4"],
  },
  viewerCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space["5"],
    paddingVertical: space["3.5"] ?? 14,
  },
  viewerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  viewerTitle: { fontSize: 14, fontWeight: "900" },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: { width: "100%", height: 320, backgroundColor: "#F5F5F4" },
});
