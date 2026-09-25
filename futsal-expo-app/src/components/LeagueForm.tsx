import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Coins,
  Globe,
  ImagePlus,
  Lock,
  ShieldCheck,
  Trophy,
  X,
} from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Picker } from "@/components/ThemedPicker";
import { createLeague, fetchVenues, updateLeague, type LeagueFormPayload } from "@/api";
import { DateField } from "@/components/DateTimeFields";
import { ImagePicker } from "@/components/ImagePicker";
import { useTheme } from "@/context/ThemeContext";
import {
  ENTRY_DEPOSIT_PERCENT,
  LEAGUE_FORMATS,
  LEAGUE_MAX_TEAMS,
  LEAGUE_MIN_TEAMS,
  LEAGUE_MODES,
  LEAGUE_NAME_MAX,
  LEAGUE_PRIZE_BREAKDOWN_MAX,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  WITHDRAW_REFUND_PERCENT,
  bracketSizeFor,
  depositFor,
  groupSetupError,
  leagueModeLabel,
  modeHasBracket,
  modeHasGroups,
  type LeagueMode,
} from "@/lib/league";
import { formatNPR, todayISO } from "@/lib/futsal";
import type { Venue } from "@/lib/types";
import {
  firstError,
  validateEntryFee,
  validateLeagueDates,
  validateLeagueName,
  validateMaxTeams,
  validatePhone,
  validatePrizeBreakdown,
  validatePrizePool,
} from "@/lib/validation";
import { fontSize, radius, space } from "@/theme";

export type LeagueFormInitial = {
  id: number;
  name: string;
  venueId: number | null;
  courtId: number | null;
  format: string;
  mode: string;
  thirdPlace: boolean;
  groupSize: number;
  maxTeams: number;
  entryFee: number;
  depositPercent: number;
  refundPercent: number;
  prizePool: number;
  prizeBreakdown: string;
  startsAt: string;
  endsAt: string;
  closesAt: string;
  matchDays: string;
  visibility: string;
  status: string;
  description: string;
  rules: string;
  contactPhone: string;
  bannerUrl: string;
};

const STATUS_OPTIONS = [
  { value: "registration", label: "📝 Taking entries" },
  { value: "ongoing", label: "🔴 Under way" },
  { value: "completed", label: "🏁 Finished" },
  { value: "cancelled", label: "🚫 Cancelled" },
] as const;

/**
 * Host a league 🎉 — a 1:1 port of the web app's components/LeagueForm.tsx.
 *
 * The same form a venue owner uses from the Owner Studio and a player uses from
 * the Leagues page — because both of them host the same way, and a second form
 * would drift from this one within a week.
 *
 * The two money fields are the interesting ones. `depositPercent` can't go below
 * 25 (`depositPercentError` on the server says why) and `refundPercent` can't go
 * above 25, so the promise a captain reads on the listing — "a quarter up
 * front, a tenth back" — is the same promise no matter who is hosting.
 *
 * Platform notes: `<input type="date">` becomes DateField chips; selects become
 * Picker; checkboxes become pressable toggles; the file banner input is
 * ImagePicker (expo-image-picker → data URL).
 */
export function LeagueForm({
  open,
  onClose,
  hostId,
  onSaved,
  initial,
  lockVenueId,
}: {
  open: boolean;
  onClose: () => void;
  hostId: number;
  onSaved: (leagueId?: number) => void;
  /** Present when the host is editing an existing league. */
  initial?: LeagueFormInitial | null;
  /** Owner Studio: their own ground, so the picker opens on it. */
  lockVenueId?: number;
}) {
  const { colors: c, isDark } = useTheme();
  const editing = !!initial?.id;
  const [venues, setVenues] = useState<Venue[]>([]);
  const [name, setName] = useState("");
  const [venueId, setVenueId] = useState("");
  const [courtId, setCourtId] = useState("");
  const [format, setFormat] = useState<string>(LEAGUE_FORMATS[0]);
  // How the competition decides a winner. Round robin is the default because
  // that's what "a league" has always meant here.
  const [mode, setMode] = useState<LeagueMode>("round_robin");
  const [thirdPlace, setThirdPlace] = useState(false);
  const [groupSize, setGroupSize] = useState(4);
  const [maxTeams, setMaxTeams] = useState(8);
  const [entryFee, setEntryFee] = useState("3000");
  const [depositPercent, setDepositPercent] = useState(ENTRY_DEPOSIT_PERCENT);
  const [refundPercent, setRefundPercent] = useState(WITHDRAW_REFUND_PERCENT);
  const [prizePool, setPrizePool] = useState("10000");
  const [prizeBreakdown, setPrizeBreakdown] = useState(
    "Champion: Rs. 6,000\nRunner-up: Rs. 3,000\nTop scorer: Rs. 1,000",
  );
  const [startsAt, setStartsAt] = useState(todayISO(7));
  const [endsAt, setEndsAt] = useState(todayISO(35));
  const [closesAt, setClosesAt] = useState(todayISO(4));
  const [matchDays, setMatchDays] = useState("Sat & Sun mornings, 7–9 AM");
  const [visibility, setVisibility] = useState("public");
  const [status, setStatus] = useState("registration");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setVenues(await fetchVenues());
      } catch {
        setVenues([]);
      }
    })();
  }, [open]);

  // Seed the form: editing loads the league's terms, hosting starts from the
  // owner's own ground (Owner Studio) so they don't have to hunt for it.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setVenueId(String(initial.venueId ?? ""));
      setCourtId(String(initial.courtId ?? ""));
      setFormat(initial.format);
      setMode(
        (LEAGUE_MODES as readonly string[]).includes(initial.mode)
          ? (initial.mode as LeagueMode)
          : "round_robin",
      );
      setThirdPlace(!!initial.thirdPlace);
      setGroupSize(initial.groupSize || 4);
      setMaxTeams(initial.maxTeams);
      setEntryFee(String(initial.entryFee));
      setDepositPercent(initial.depositPercent);
      setRefundPercent(initial.refundPercent);
      setPrizePool(String(initial.prizePool));
      setPrizeBreakdown(initial.prizeBreakdown);
      setStartsAt(initial.startsAt);
      setEndsAt(initial.endsAt);
      setClosesAt(initial.closesAt);
      setMatchDays(initial.matchDays);
      setVisibility(initial.visibility);
      setStatus(initial.status);
      setDescription(initial.description);
      setRules(initial.rules);
      setContactPhone(initial.contactPhone);
      setBannerUrl(initial.bannerUrl);
      return;
    }
    if (lockVenueId) setVenueId(String(lockVenueId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, lockVenueId]);

  const venue = useMemo(
    () => venues.find((v) => String(v.id) === venueId),
    [venues, venueId],
  );
  const deposit = depositFor(Number(entryFee) || 0, depositPercent);
  const spots = Number(maxTeams) || 0;

  async function save() {
    const feeNum = entryFee === "" ? 0 : Number(entryFee);
    const poolNum = prizePool === "" ? 0 : Number(prizePool);
    const err = firstError(
      validateLeagueName(name),
      venueId ? null : "Pick the ground this league plays on 🏟️",
      validateMaxTeams(maxTeams),
      groupSetupError({ mode, groupSize, maxTeams }),
      validateEntryFee(feeNum),
      validatePrizePool(poolNum),
      validatePrizeBreakdown(prizeBreakdown),
      validateLeagueDates(startsAt, endsAt, closesAt),
      validatePhone(contactPhone, { required: false }),
    );
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const payload: LeagueFormPayload = {
        hostId,
        name,
        venueId: Number(venueId),
        courtId: courtId ? Number(courtId) : 0,
        format,
        mode,
        thirdPlace: modeHasBracket(mode) ? thirdPlace : false,
        groupSize,
        maxTeams,
        entryFee: feeNum,
        depositPercent,
        refundPercent,
        prizePool: poolNum,
        prizeBreakdown,
        startsAt,
        endsAt,
        closesAt,
        matchDays,
        visibility,
        status,
        description,
        rules,
        contactPhone,
        bannerUrl,
      };
      const data = editing
        ? await updateLeague(initial!.id, payload)
        : await createLeague(payload);
      onSaved(data.league?.id ?? initial?.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the league 🙏");
    } finally {
      setBusy(false);
    }
  }

  /**
   * What the draw will actually look like, before the host commits to it — the
   * same arithmetic the server runs when it draws, so the promise on the form
   * and the fixture list can't disagree.
   */
  function drawHint(m: LeagueMode, squadCount: number, perGroup: number, bronze: boolean) {
    const n = Math.max(0, Math.trunc(squadCount) || 0);
    if (n < 2) return "Pick how many squads can enter and the shape of the draw shows here.";
    if (m === "round_robin")
      return `🔄 ${n} squads = ${(n * (n - 1)) / 2} fixtures — everyone plays everyone once, and the table decides.`;
    if (m === "group_knockout") {
      const size = Math.min(Math.max(MIN_GROUP_SIZE, perGroup), MAX_GROUP_SIZE);
      let groups = Math.max(2, Math.ceil(n / size));
      while (groups > 2 && Math.floor(n / groups) < 2) groups -= 1;
      const through = groups * 2;
      const bracket = bracketSizeFor(through);
      return `🎯 ${groups} groups (${n < groups * size ? "sizes balanced from " : ""}${n} squads) — top two of each go to a ${bracket}-squad bracket${bronze ? " plus a third-place game" : ""}.`;
    }
    const size = bracketSizeFor(n);
    const byes = size - n;
    return `🥊 A bracket of ${size}: ${n} squads, ${byes > 0 ? `${byes} bye${byes === 1 ? "" : "s"} for the top seeds` : "no byes needed"}, one loss and you're out${bronze ? " — plus a third-place game for the losing semi-finalists" : ""}.`;
  }

  if (!open) return null;

  const labelStyle = [styles.label, { color: c.textFaint }];
  const inputStyle = [
    styles.input,
    { borderColor: c.border, color: c.text, backgroundColor: c.surface },
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { backgroundColor: isDark ? "#0F172A" : "#FFFDF7" }]}>
            <View style={[styles.sheetHead, { borderColor: c.border, backgroundColor: c.surface }]}>
              <View style={styles.grow}>
                <View style={styles.headTitleRow}>
                  <Trophy size={16} color={isDark ? "#6EE7B7" : "#047857"} />
                  <Text style={[styles.headTitle, { color: c.text }]}>
                    {editing ? "Edit your league" : "Host a league"}
                  </Text>
                </View>
                <Text style={[styles.headSub, { color: c.textMuted }]}>
                  One ground, many squads, real results — players and venue owners both host here.
                </Text>
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

            <ScrollView style={styles.formScroll} contentContainerStyle={styles.formBody}>
              <Text style={labelStyle}>League name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                maxLength={LEAGUE_NAME_MAX}
                placeholder="e.g. Chabahil Premier League — Season 2"
                placeholderTextColor={c.textFaint}
                style={inputStyle}
              />

              {/* ------------------------------------------- how a winner is decided */}
              <View style={[styles.modeBox, { borderColor: c.border, backgroundColor: c.surface }]}>
                <Text style={labelStyle}>How does it decide a winner?</Text>
                <View style={styles.modeGrid}>
                  {LEAGUE_MODES.map((m) => {
                    const info = leagueModeLabel(m);
                    const on = mode === m;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => setMode(m)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[
                          styles.modeCard,
                          on
                            ? {
                                borderColor: "#10B981",
                                backgroundColor: isDark ? "rgba(16,185,129,0.10)" : "#ECFDF5",
                              }
                            : { borderColor: c.border },
                        ]}
                      >
                        <View style={styles.modeTitleRow}>
                          <Text style={styles.modeEmoji}>{info.emoji}</Text>
                          <Text style={[styles.modeTitle, { color: c.text }]}>{info.label}</Text>
                          {on ? <Check size={14} color="#059669" /> : null}
                        </View>
                        <Text style={[styles.modeBlurb, { color: c.textMuted }]}>{info.blurb}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.modeOpts}>
                  {modeHasGroups(mode) ? (
                    <View style={styles.modeOpt}>
                      <Text style={labelStyle}>Squads per group</Text>
                      <TextInput
                        value={String(groupSize)}
                        onChangeText={(t) => setGroupSize(Number(t.replace(/[^0-9]/g, "")) || 0)}
                        keyboardType="number-pad"
                        style={[styles.smallNum, { borderColor: c.border, color: c.text, backgroundColor: c.inset }]}
                      />
                    </View>
                  ) : null}
                  {modeHasBracket(mode) ? (
                    <Pressable
                      onPress={() => setThirdPlace((v) => !v)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: thirdPlace }}
                      style={styles.modeOpt}
                    >
                      <View style={[styles.check, { borderColor: thirdPlace ? "#059669" : c.border, backgroundColor: thirdPlace ? "#059669" : "transparent" }]}>
                        {thirdPlace ? <Check size={12} color="#FFFFFF" /> : null}
                      </View>
                      <Text style={[styles.modeOptLabel, { color: c.textFaint }]}>
                        🥉 Third-place game
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                <Text style={[styles.drawHint, { backgroundColor: c.inset, color: c.textMuted }]}>
                  {drawHint(mode, spots, groupSize, thirdPlace)}
                </Text>
                {editing ? (
                  <Text style={styles.editingNote}>
                    Once fixtures are drawn the competition type can't change — the server will
                    say so.
                  </Text>
                ) : null}
              </View>

              <Text style={labelStyle}>Ground</Text>
              <View style={[styles.pickerBox, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Picker
                  selectedValue={venueId}
                  onValueChange={(v) => {
                    setVenueId(String(v));
                    setCourtId("");
                  }}
                  style={{ color: c.text }}
                >
                  <Picker.Item label="Pick a ground…" value="" />
                  {venues.map((v) => (
                    <Picker.Item key={v.id} label={`${v.name} — ${v.city}`} value={String(v.id)} />
                  ))}
                </Picker>
              </View>

              <Text style={labelStyle}>Pitch (optional)</Text>
              <View
                style={[
                  styles.pickerBox,
                  { backgroundColor: c.surface, borderColor: c.border, opacity: venue ? 1 : 0.5 },
                ]}
              >
                <Picker
                  selectedValue={courtId}
                  onValueChange={(v) => setCourtId(String(v))}
                  enabled={!!venue}
                  style={{ color: c.text }}
                >
                  <Picker.Item label="Whatever is free" value="" />
                  {(venue?.courts ?? []).map((ct) => (
                    <Picker.Item key={ct.id} label={ct.name} value={String(ct.id)} />
                  ))}
                </Picker>
              </View>

              <Text style={labelStyle}>Format</Text>
              <View style={[styles.pickerBox, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Picker selectedValue={format} onValueChange={setFormat} style={{ color: c.text }}>
                  {LEAGUE_FORMATS.map((f) => (
                    <Picker.Item key={f} label={f} value={f} />
                  ))}
                </Picker>
              </View>

              <Text style={labelStyle}>
                How many squads ({LEAGUE_MIN_TEAMS}–{LEAGUE_MAX_TEAMS})
              </Text>
              <TextInput
                value={String(maxTeams)}
                onChangeText={(t) => setMaxTeams(Number(t.replace(/[^0-9]/g, "")) || 0)}
                keyboardType="number-pad"
                style={inputStyle}
              />
              <Text style={[styles.hint, { color: c.textFaint }]}>
                {spots >= 2 ? `A round robin means ${(spots * (spots - 1)) / 2} fixtures 🗓️` : " "}
              </Text>

              {/* ---------------------------------------------------------- money */}
              <View
                style={[
                  styles.moneyBox,
                  {
                    borderColor: isDark ? "rgba(16,185,129,0.25)" : "#A7F3D0",
                    backgroundColor: isDark ? "rgba(16,185,129,0.05)" : "rgba(236,253,245,0.6)",
                  },
                ]}
              >
                <View style={styles.headTitleRow}>
                  <Coins size={14} color={isDark ? "#6EE7B7" : "#047857"} />
                  <Text style={[styles.moneyTitle, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                    Entry fee, deposit &amp; prize
                  </Text>
                </View>

                <Text style={labelStyle}>Entry fee per squad (Rs.)</Text>
                <TextInput
                  value={entryFee}
                  onChangeText={setEntryFee}
                  keyboardType="number-pad"
                  style={inputStyle}
                />

                <Text style={labelStyle}>Prize pool (Rs.)</Text>
                <TextInput
                  value={prizePool}
                  onChangeText={setPrizePool}
                  keyboardType="number-pad"
                  style={inputStyle}
                />

                <Text style={labelStyle}>Deposit to hold a place (%)</Text>
                <TextInput
                  value={String(depositPercent)}
                  onChangeText={(t) => setDepositPercent(Number(t.replace(/[^0-9]/g, "")) || 0)}
                  keyboardType="number-pad"
                  style={inputStyle}
                />
                <View style={styles.inlineHint}>
                  <ShieldCheck size={12} color={isDark ? "#6EE7B7" : "#047857"} />
                  <Text style={[styles.inlineHintText, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                    {formatNPR(deposit)} up front — at least {ENTRY_DEPOSIT_PERCENT}%
                  </Text>
                </View>

                <Text style={labelStyle}>What a quitter gets back (%)</Text>
                <TextInput
                  value={String(refundPercent)}
                  onChangeText={(t) => setRefundPercent(Number(t.replace(/[^0-9]/g, "")) || 0)}
                  keyboardType="number-pad"
                  style={inputStyle}
                />
                <Text style={[styles.hint, { color: c.textMuted }]}>
                  Paid {formatNPR(Number(entryFee) || 0)}, back{" "}
                  {formatNPR(Math.floor(((Number(entryFee) || 0) * refundPercent) / 100))} if they
                  walk away
                </Text>

                <Text style={labelStyle}>Prize split (one place per line)</Text>
                <TextInput
                  value={prizeBreakdown}
                  onChangeText={setPrizeBreakdown}
                  maxLength={LEAGUE_PRIZE_BREAKDOWN_MAX}
                  multiline
                  placeholder={"Champion: Rs. 6,000\nRunner-up: Rs. 3,000\nTrophy + free hours"}
                  placeholderTextColor={c.textFaint}
                  style={[...inputStyle, styles.multiline]}
                />
              </View>

              {/* ---------------------------------------------------------- dates */}
              <DateField label="Starts" value={startsAt} onChange={setStartsAt} />
              <DateField label="Final date" value={endsAt} onChange={setEndsAt} allowClear />
              <DateField label="Entries close" value={closesAt} onChange={setClosesAt} allowClear />
              <Text style={labelStyle}>🗓 Match days</Text>
              <TextInput
                value={matchDays}
                onChangeText={setMatchDays}
                placeholder="Sat & Sun mornings, 7–9 AM"
                placeholderTextColor={c.textFaint}
                style={inputStyle}
              />

              {/* ----------------------------------------------------- visibility */}
              <Text style={labelStyle}>Who can see it</Text>
              <View style={styles.visGrid}>
                <Pressable
                  onPress={() => setVisibility("public")}
                  accessibilityRole="button"
                  accessibilityState={{ selected: visibility === "public" }}
                  style={[
                    styles.visCard,
                    visibility === "public"
                      ? {
                          borderColor: "#10B981",
                          backgroundColor: isDark ? "rgba(16,185,129,0.10)" : "#ECFDF5",
                        }
                      : { borderColor: c.border, backgroundColor: c.surface },
                  ]}
                >
                  <View style={styles.headTitleRow}>
                    <Globe size={16} color={isDark ? "#6EE7B7" : "#047857"} />
                    <Text style={[styles.visTitle, { color: c.text }]}>Open listing</Text>
                  </View>
                  <Text style={[styles.visSub, { color: c.textMuted }]}>
                    Anyone can find it, read the terms and ask for a spot. Best for growing a
                    league.
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setVisibility("private")}
                  accessibilityRole="button"
                  accessibilityState={{ selected: visibility === "private" }}
                  style={[
                    styles.visCard,
                    visibility === "private"
                      ? {
                          borderColor: "#FBBF24",
                          backgroundColor: isDark ? "rgba(245,158,11,0.10)" : "#FFFBEB",
                        }
                      : { borderColor: c.border, backgroundColor: c.surface },
                  ]}
                >
                  <View style={styles.headTitleRow}>
                    <Lock size={16} color={isDark ? "#FBBF24" : "#B45309"} />
                    <Text style={[styles.visTitle, { color: c.text }]}>Private</Text>
                  </View>
                  <Text style={[styles.visSub, { color: c.textMuted }]}>
                    Hidden from everyone except the squads you invite. Requests are switched off.
                  </Text>
                </Pressable>
              </View>

              {editing ? (
                <>
                  <Text style={labelStyle}>👑 League stage</Text>
                  <View style={[styles.pickerBox, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <Picker selectedValue={status} onValueChange={setStatus} style={{ color: c.text }}>
                      {STATUS_OPTIONS.map((s) => (
                        <Picker.Item key={s.value} label={s.label} value={s.value} />
                      ))}
                    </Picker>
                  </View>
                </>
              ) : null}

              <Text style={labelStyle}>Pitch it to captains</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                maxLength={600}
                multiline
                placeholder="What is the league, who plays, what's the vibe?"
                placeholderTextColor={c.textFaint}
                style={[...inputStyle, styles.multiline]}
              />

              <Text style={labelStyle}>Rules</Text>
              <TextInput
                value={rules}
                onChangeText={setRules}
                maxLength={800}
                multiline
                placeholder="Minutes per half, subs, discipline, borrowed players…"
                placeholderTextColor={c.textFaint}
                style={[...inputStyle, styles.multiline]}
              />

              <Text style={labelStyle}>Contact phone</Text>
              <TextInput
                value={contactPhone}
                onChangeText={setContactPhone}
                placeholder="98XXXXXXXX"
                placeholderTextColor={c.textFaint}
                keyboardType="phone-pad"
                style={inputStyle}
              />

              <View style={styles.bannerField}>
                <View style={styles.headTitleRow}>
                  <ImagePlus size={14} color={c.textFaint} />
                  <Text style={labelStyle}>Banner</Text>
                </View>
                <ImagePicker value={bannerUrl} onChange={setBannerUrl} label="League banner" />
              </View>

              {error ? (
                <View style={[styles.errorBox, { backgroundColor: isDark ? "rgba(239,68,68,0.10)" : "#FEF2F2" }]}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.footerRow}>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  style={[styles.cancelBtn, { borderColor: c.border }]}
                >
                  <Text style={[styles.cancelText, { color: c.textMuted }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void save()}
                  disabled={busy}
                  accessibilityRole="button"
                  style={[styles.saveBtn, busy ? styles.disabled : null]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Trophy size={16} color="#FFFFFF" />
                  )}
                  <Text style={styles.saveText}>
                    {editing ? "Save changes" : "Launch the league 🚀"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: radius["3xl"],
    borderTopRightRadius: radius["3xl"],
    maxHeight: "92%",
    overflow: "hidden",
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space["3"],
    paddingHorizontal: space["5"],
    paddingVertical: space["4"],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headTitle: { fontSize: fontSize.lg, fontWeight: "900" },
  headSub: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  formScroll: { maxHeight: 640 },
  formBody: { padding: space["5"], gap: space["2.5"] ?? 10 },
  label: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: space["2"],
  },
  input: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space["3.5"] ?? 14,
    paddingVertical: 12,
    fontSize: fontSize.base,
    fontWeight: "600",
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  hint: { fontSize: 11, fontWeight: "600" },
  modeBox: { borderRadius: radius.xl, borderWidth: 1, padding: space["4"], gap: 6 },
  modeGrid: { gap: space["2"] },
  modeCard: { borderRadius: radius.xl, borderWidth: 2, padding: space["3"] },
  modeTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  modeEmoji: { fontSize: fontSize.base },
  modeTitle: { fontSize: fontSize.base, fontWeight: "900", flex: 1 },
  modeBlurb: { fontSize: 11, fontWeight: "600", lineHeight: 16, marginTop: 4 },
  modeOpts: { flexDirection: "row", flexWrap: "wrap", gap: space["4"], marginTop: 4 },
  modeOpt: { flexDirection: "row", alignItems: "center", gap: 8 },
  modeOptLabel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  smallNum: {
    width: 80,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: fontSize.sm,
    fontWeight: "900",
    textAlign: "center",
  },
  drawHint: {
    borderRadius: radius.lg,
    paddingHorizontal: space["3"],
    paddingVertical: 8,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: 4,
  },
  editingNote: { fontSize: 11, fontWeight: "600", color: "#D97706", marginTop: 4 },
  pickerBox: { borderRadius: radius.xl, borderWidth: 1, overflow: "hidden", justifyContent: "center" },
  moneyBox: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space["4"],
    gap: 4,
    marginTop: space["3"],
  },
  moneyTitle: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  inlineHint: { flexDirection: "row", alignItems: "center", gap: 6 },
  inlineHintText: { fontSize: 11, fontWeight: "900" },
  visGrid: { gap: space["2"] },
  visCard: { borderRadius: radius.xl, borderWidth: 2, padding: space["3.5"] ?? 14 },
  visTitle: { fontSize: fontSize.base, fontWeight: "900" },
  visSub: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  bannerField: { gap: 4, marginTop: space["2"] },
  errorBox: { borderRadius: radius.xl, paddingHorizontal: space["4"], paddingVertical: 12, marginTop: space["3"] },
  errorText: { fontSize: fontSize.sm, fontWeight: "700", color: "#DC2626" },
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space["2"],
    marginTop: space["4"],
    marginBottom: space["6"],
  },
  cancelBtn: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 20,
    paddingVertical: 12,
    justifyContent: "center",
  },
  cancelText: { fontSize: fontSize.base, fontWeight: "900" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#059669",
    borderRadius: radius.xl,
    paddingHorizontal: 24,
    paddingVertical: 12,
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  saveText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  disabled: { opacity: 0.5 },
});
