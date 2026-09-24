import * as ImagePickerLib from "expo-image-picker";
import {
  Camera,
  ExternalLink,
  ImagePlus,
  Link as LinkIcon,
  Lock,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { leagueMediaAction } from "@/api";
import { MAX_IMAGE_BYTES } from "@/components/ImagePicker";
import { useTheme } from "@/context/ThemeContext";
import { validateExternalUrl } from "@/lib/validation";
import { timeAgo } from "@/lib/time";
import type { LeagueDetail, LeagueMediaRow } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";

/**
 * The album 📸 — a 1:1 port of the web app's components/LeagueAlbum.tsx.
 *
 * Two ways in, because two ways is what a host actually has: pick a photo off
 * the phone (stored as a data URL, the same trick the receipt uploader uses — no
 * storage service needed) or paste a link to the Drive/Facebook album they
 * already keep.
 *
 * Who can *see* it is decided on the server, not here: the host plus the squads
 * in the league for a league-wide photo, one selected squad when the additive
 * teamId media capability is available, and only the two squads that played a
 * fixture for fixture photos. Older servers keep the league/match contract; a
 * team-only upload is rejected and removed rather than silently becoming public.
 *
 * Platform deltas: the web's file input becomes expo-image-picker (data URL
 * output identical to FileReader); "Download all" (a browser .zip via DOM
 * blob/anchor) has no RN equivalent without new native modules, so it is not
 * ported — previews and external links (Linking.openURL) are.
 */
type MediaScope = "league" | `team:${number}` | `match:${number}`;

export function LeagueAlbum({
  league,
  hostId,
  isHost,
  focusMatchId,
  onChanged,
}: {
  league: LeagueDetail;
  hostId: number;
  isHost: boolean;
  focusMatchId?: number | null;
  onChanged: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"file" | "link">("link");
  const [linkUrl, setLinkUrl] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [picking, setPicking] = useState(false);
  const [caption, setCaption] = useState("");
  const [scope, setScope] = useState<MediaScope>(
    focusMatchId ? `match:${focusMatchId}` : "league",
  );
  const [preview, setPreview] = useState<LeagueMediaRow | null>(null);

  useEffect(() => {
    if (focusMatchId) setScope(`match:${focusMatchId}`);
  }, [focusMatchId]);

  const photos = league.media.filter((m) => m.kind === "file");
  const links = league.media.filter((m) => m.kind === "link");
  const playedMatches = league.matches.filter((m) => m.status === "played");
  const selectedTeamId = scope.startsWith("team:") ? Number(scope.slice(5)) : null;
  const selectedMatchId = scope.startsWith("match:") ? Number(scope.slice(6)) : null;
  const selectedTeam = selectedTeamId
    ? league.teams.find((team) => team.teamId === selectedTeamId)
    : null;

  async function pickFile() {
    setErr("");
    try {
      const perm = await ImagePickerLib.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErr("Allow photo access to pick a photo 📸");
        return;
      }
      setPicking(true);
      const res = await ImagePickerLib.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]) {
        setPicking(false);
        return;
      }
      const asset = res.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_IMAGE_BYTES) {
        setPicking(false);
        setErr("That photo is over 2.5MB — use a smaller one, or paste a Drive link instead 🔗");
        return;
      }
      setFileUrl(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
      setPicking(false);
    } catch {
      setPicking(false);
      setErr("Couldn't read that file — try another one.");
    }
  }

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg("");
    setErr("");
    try {
      const data = await leagueMediaAction(league.id, { userId: hostId, ...body });
      const requestedTeamId = Number(body.teamId ?? 0) || null;
      const savedTeamId = Number(data.media?.teamId ?? 0) || null;

      // The reference API predates squad-scoped media and ignores unknown JSON
      // keys. Never tell a host that a team-only photo worked when that would
      // actually have made a league-wide row: remove the just-created row and
      // explain the compatibility boundary instead.
      if (requestedTeamId && savedTeamId !== requestedTeamId) {
        let cleanedUp = Boolean(data.media?.id);
        if (data.media?.id) {
          try {
            await leagueMediaAction(league.id, {
              userId: hostId,
              action: "delete",
              mediaId: data.media.id,
            });
          } catch {
            cleanedUp = false;
          }
        }
        throw new Error(
          cleanedUp
            ? "This server does not support squad-only photo sharing yet. Nothing was added; choose Whole league or a fixture instead."
            : "This server did not acknowledge squad-only photo sharing, and cleanup needs attention. Please check the album before trying again.",
        );
      }

      setMsg(String(data.message ?? "Added 📸"));
      setLinkUrl("");
      setFileUrl("");
      setCaption("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  const noticeTone = err
    ? { bg: isDark ? "rgba(239,68,68,0.10)" : "#FEF2F2", fg: "#DC2626" }
    : { bg: isDark ? "rgba(5,150,105,0.10)" : "#ECFDF5", fg: "#047857" };

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Camera size={14} color={isDark ? "#6EE7B7" : "#047857"} />
          <Text style={[styles.title, { color: isDark ? "#6EE7B7" : "#047857" }]}>
            Match photos
          </Text>
          <View style={[styles.countChip, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "#F5F5F4" }]}>
            <Text style={[styles.countChipText, { color: isDark ? "#CBD5E1" : "#78716C" }]}>
              {league.media.length}
            </Text>
          </View>
        </View>
        <View style={styles.lockLine}>
          <Lock size={10} color={c.textFaint} />
          <Text style={[styles.lockText, { color: c.textFaint }]}>
            {selectedTeam ? `Host + ${selectedTeam.name} only` : "Host + the squads involved only"}
          </Text>
        </View>
      </View>

      {msg || err ? (
        <View style={[styles.notice, { backgroundColor: noticeTone.bg }]}>
          <Text style={[styles.noticeText, { color: noticeTone.fg }]}>{err || msg}</Text>
        </View>
      ) : null}

      {isHost ? (
        <View style={[styles.uploadBox, { borderColor: isDark ? "rgba(16,185,129,0.3)" : "#6EE7B7" }]}>
          <View style={styles.tabs}>
            {(["link", "file"] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === t }}
                style={[
                  styles.tab,
                  tab === t
                    ? { backgroundColor: "#059669" }
                    : { borderWidth: 1, borderColor: c.border },
                ]}
              >
                {t === "link" ? (
                  <LinkIcon size={12} color={tab === t ? "#FFFFFF" : c.textMuted} />
                ) : (
                  <ImagePlus size={12} color={tab === t ? "#FFFFFF" : c.textMuted} />
                )}
                <Text style={[styles.tabText, { color: tab === t ? "#FFFFFF" : c.textMuted }]}>
                  {t === "link" ? "Paste an album link" : "Upload a photo"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.uploadFields}>
            {tab === "link" ? (
              <TextInput
                value={linkUrl}
                onChangeText={setLinkUrl}
                placeholder="https://drive.google.com/… or a Facebook album"
                placeholderTextColor={c.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.inset }]}
              />
            ) : (
              <Pressable
                onPress={() => void pickFile()}
                disabled={picking}
                accessibilityRole="button"
                style={[styles.pickFileBtn, { borderColor: c.border, backgroundColor: c.inset }]}
              >
                {picking ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
                <Text style={[styles.pickFileText, { color: c.textMuted }]}>
                  {picking
                    ? "Reading…"
                    : fileUrl
                      ? "Change photo ✓"
                      : "Choose a photo from this device"}
                </Text>
              </Pressable>
            )}
            <View style={[styles.pickerBox, { backgroundColor: c.inset, borderColor: c.border }]}>
              <Picker selectedValue={scope} onValueChange={(v) => setScope(v as MediaScope)} style={{ color: c.text }}>
                <Picker.Item label="Whole league (every squad in it)" value="league" />
                {league.teams.map((team) => (
                  <Picker.Item
                    key={`team-${team.teamId}`}
                    label={`Only ${team.name} squad`}
                    value={`team:${team.teamId}`}
                  />
                ))}
                {playedMatches.map((m) => (
                  <Picker.Item
                    key={`match-${m.id}`}
                    label={`${m.round}: ${m.homeTeamName} ${m.homeScore}–${m.awayScore} ${m.awayTeamName}`}
                    value={`match:${m.id}`}
                  />
                ))}
              </Picker>
            </View>
            <Text style={[styles.scopeHint, { color: c.textFaint }]}>
              {selectedTeam
                ? `Only ${selectedTeam.name} should see this photo. This requires the server's squad-audience media capability.`
                : selectedMatchId
                  ? "Only the two squads in this played fixture can see it."
                  : "Every approved squad in the league can see it."}
            </Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Caption (optional)"
              placeholderTextColor={c.textFaint}
              maxLength={160}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.inset }]}
            />
            <Pressable
              onPress={() => {
                const url = tab === "link" ? linkUrl.trim() : fileUrl;
                const linkErr = tab === "link" ? validateExternalUrl(url) : null;
                if (linkErr) {
                  setErr(linkErr);
                  return;
                }
                if (tab === "file" && !url) {
                  setErr("Choose a photo first 📸");
                  return;
                }
                void post(
                  {
                    action: "add",
                    kind: tab,
                    url,
                    caption,
                    matchId: selectedMatchId,
                    teamId: selectedTeamId,
                  },
                  "add",
                );
              }}
              disabled={busy !== ""}
              accessibilityRole="button"
              style={[styles.addBtn, busy !== "" ? styles.disabled : null]}
            >
              {busy === "add" ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Camera size={14} color="#FFFFFF" />}
              <Text style={styles.addBtnText}>Add to the album</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {league.media.length === 0 ? (
        <View style={[styles.emptyBox, { borderColor: c.border }]}>
          <Text style={[styles.emptyText, { color: c.textFaint }]}>
            No photos yet.{" "}
            {isHost
              ? "Upload the tournament photos, or paste the Drive link you already share with the squads."
              : "The host will post photos here after each round."}
          </Text>
        </View>
      ) : (
        <>
          {photos.length > 0 ? (
            <View style={styles.photoGrid}>
              {photos.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setPreview(p)}
                  accessibilityRole="button"
                  style={[styles.photoTile, { borderColor: c.border }]}
                >
                  <Image source={{ uri: p.url }} style={styles.photoImg} resizeMode="cover" />
                  <View style={styles.photoCaptionBar}>
                    <Text style={styles.photoCaption} numberOfLines={1}>
                      {p.caption || "Match photo"}
                    </Text>
                    <Text style={styles.photoScope} numberOfLines={1}>
                      {p.scope}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          {links.length > 0 ? (
            <View style={styles.linkList}>
              {links.map((l) => (
                <View key={l.id} style={[styles.linkRow, { backgroundColor: c.inset }]}>
                  <Pressable
                    onPress={() => void Linking.openURL(l.url).catch(() => undefined)}
                    accessibilityRole="link"
                    style={styles.linkMain}
                  >
                    <LinkIcon size={14} color={isDark ? "#6EE7B7" : "#047857"} />
                    <Text
                      style={[styles.linkText, { color: isDark ? "#6EE7B7" : "#047857" }]}
                      numberOfLines={1}
                    >
                      {l.caption || l.url}
                    </Text>
                    <ExternalLink size={12} color={isDark ? "#6EE7B7" : "#047857"} style={{ opacity: 0.6 }} />
                  </Pressable>
                  <View style={styles.linkMeta}>
                    <View style={styles.linkScope}>
                      <Lock size={10} color={c.textFaint} />
                      <Text style={[styles.linkScopeText, { color: c.textFaint }]}>{l.scope}</Text>
                    </View>
                    <Text style={[styles.linkTime, { color: c.textFaint }]}>
                      {l.createdAt ? timeAgo(l.createdAt) : ""}
                    </Text>
                    {isHost ? (
                      <Pressable
                        onPress={() => void post({ action: "delete", mediaId: l.id }, `del-${l.id}`)}
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        accessibilityLabel="Delete link"
                        style={styles.linkDelete}
                      >
                        <Trash2 size={12} color={c.textFaint} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}

      {/* Preview modal — the web's fixed overlay + Download/Remove footer,
          minus Download (browser-only; see the note above). */}
      <Modal visible={preview !== null} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreview(null)}>
          <View style={[styles.previewCard, { backgroundColor: c.surface }]}>
            <View style={styles.previewHead}>
              <View style={styles.grow}>
                <Text style={[styles.previewTitle, { color: c.text }]} numberOfLines={1}>
                  {preview?.caption || "Match photo"}
                </Text>
                <Text style={[styles.previewSub, { color: c.textFaint }]} numberOfLines={1}>
                  {preview?.scope} • {preview?.credit || preview?.uploaderName}
                </Text>
              </View>
              <Pressable
                onPress={() => setPreview(null)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={[styles.closeBtn, { backgroundColor: c.inset }]}
              >
                <X size={16} color={c.textMuted} />
              </Pressable>
            </View>
            {preview ? (
              <Image source={{ uri: preview.url }} style={styles.previewImg} resizeMode="contain" />
            ) : null}
            <View style={styles.previewFoot}>
              {isHost && preview ? (
                <Pressable
                  onPress={() => {
                    void post({ action: "delete", mediaId: preview.id }, `del-${preview.id}`);
                    setPreview(null);
                  }}
                  accessibilityRole="button"
                  style={[styles.removeBtn, { borderColor: isDark ? "rgba(239,68,68,0.3)" : "#FECACA" }]}
                >
                  <Trash2 size={12} color="#EF4444" />
                  <Text style={styles.removeText}>Remove photo</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space["5"],
    gap: space["3"],
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space["2"],
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  countChip: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  countChipText: { fontSize: 10, fontWeight: "900" },
  lockLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  lockText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  notice: { borderRadius: radius.xl, paddingHorizontal: space["4"], paddingVertical: 10 },
  noticeText: { fontSize: fontSize.sm, fontWeight: "700" },
  uploadBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.xl,
    padding: space["3.5"] ?? 14,
    gap: space["2.5"] ?? 10,
  },
  tabs: { flexDirection: "row", gap: 6 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tabText: { fontSize: 11, fontWeight: "900" },
  uploadFields: { gap: space["2"] },
  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space["3"],
    paddingVertical: 10,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  pickFileBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: 11,
  },
  pickFileText: { fontSize: fontSize.sm, fontWeight: "900" },
  pickerBox: { borderRadius: radius.lg, borderWidth: 1, overflow: "hidden", justifyContent: "center" },
  scopeHint: { fontSize: fontSize["2xs"], fontWeight: "700", lineHeight: 15, marginTop: -2 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1C1917",
    borderRadius: radius.lg,
    paddingVertical: 11,
  },
  addBtnText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },
  disabled: { opacity: 0.5 },
  emptyBox: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingHorizontal: space["4"],
    paddingVertical: 32,
  },
  emptyText: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: space["2"] },
  photoTile: {
    width: "48%",
    flexGrow: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },
  photoImg: { width: "100%", height: 128 },
  photoCaptionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingBottom: 6,
    paddingTop: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  photoCaption: { fontSize: 10, fontWeight: "900", color: "#FFFFFF" },
  photoScope: { fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.7)" },
  linkList: { gap: 6 },
  linkRow: {
    borderRadius: radius.xl,
    paddingHorizontal: space["3.5"] ?? 14,
    paddingVertical: 10,
    gap: 4,
  },
  linkMain: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  linkText: { flex: 1, fontSize: fontSize.sm, fontWeight: "700" },
  linkMeta: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  linkScope: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkScopeText: { fontSize: 10, fontWeight: "700" },
  linkTime: { fontSize: 10, fontWeight: "700" },
  linkDelete: {
    borderWidth: 1,
    borderColor: "rgba(163,163,163,0.35)",
    borderRadius: radius.lg,
    padding: 5,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: space["4"],
  },
  previewCard: { width: "100%", maxWidth: 420, borderRadius: radius["3xl"], overflow: "hidden" },
  previewHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: space["4"],
    paddingVertical: space["3"],
  },
  grow: { flex: 1, minWidth: 0 },
  previewTitle: { fontSize: fontSize.base, fontWeight: "900" },
  previewSub: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  previewImg: { width: "100%", height: 280, backgroundColor: "#F5F5F4" },
  previewFoot: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: space["4"],
    paddingVertical: space["3"],
    gap: 8,
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  removeText: { fontSize: 11, fontWeight: "900", color: "#EF4444" },
});
