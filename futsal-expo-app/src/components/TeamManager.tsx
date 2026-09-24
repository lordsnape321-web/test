import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  Check,
  Copy,
  Crown,
  Dice5,
  Hourglass,
  MailQuestion,
  MapPin,
  Plus,
  Search,
  Send,
  Shield,
  UserX,
  Users,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import * as Clipboard from "expo-clipboard";
import {
  fetchPlayerDirectory,
  fetchTeamInvites,
  fetchTeamRequests,
  fetchTeamRoster,
  fetchVenues,
  removeTeamMember,
  sendTeamInvite,
  teamRequestAction,
  updateTeam,
  withdrawTeamInvite,
} from "@/api";
import { Avatar } from "@/components/Avatar";
import { useTheme } from "@/context/ThemeContext";
import {
  TEAM_DESCRIPTION_MAX,
  TEAM_INVITE_DAILY_LIMIT,
  normalizeTeamCode,
  suggestTeamCode,
  type Quota,
} from "@/lib/teams";
import {
  firstError,
  validateMessage,
  validateTeamCode,
  validateTeamDescription,
  validateTitle,
} from "@/lib/validation";
import type { ManagedTeam, TeamRosterRow, TeamRequestRow, TeamSentInvite } from "@/lib/types";
import { colors as tokens, fontSize, radius, space } from "@/theme";

export type { ManagedTeam };

type Candidate = {
  id: number;
  name: string;
  email: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  role?: string;
};

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#4d7c0f"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];

/**
 * The captain's panel 👑 — a 1:1 port of the web app's components/TeamManager.tsx.
 *
 * One place to run a squad: decide join requests, invite players (who then
 * decide for themselves), remove members, hand over the armband, and edit the
 * team's details. Only the captain ever sees this; every action re-checks that
 * server-side, so the UI hiding a button is a courtesy rather than the security.
 *
 * Platform notes: the web's fixed overlay becomes a Modal; clipboard write uses
 * expo-clipboard; checkbox becomes a Switch.
 */
export function TeamManager({
  team,
  captainId,
  onClose,
  onChanged,
}: {
  team: ManagedTeam;
  captainId: number;
  onClose: () => void;
  /** Lets the parent refresh its team list after any mutation. */
  onChanged: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const inputFill = isDark ? "rgba(255,255,255,0.05)" : tokens.insetCream;

  const [roster, setRoster] = useState<TeamRosterRow[]>([]);
  const [requests, setRequests] = useState<TeamRequestRow[]>([]);
  const [invites, setInvites] = useState<TeamSentInvite[]>([]);
  const [inviteQuota, setInviteQuota] = useState<Quota>({
    used: 0,
    limit: TEAM_INVITE_DAILY_LIMIT,
    left: TEAM_INVITE_DAILY_LIMIT,
  });
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [venueOptions, setVenueOptions] = useState<Array<{ id: number; name: string; city: string }>>([]);
  const [people, setPeople] = useState<Candidate[]>([]);
  const [find, setFind] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  // Editable copy of the team details.
  const [name, setName] = useState(team.name);
  const [motto, setMotto] = useState(team.motto);
  const [description, setDescription] = useState(team.description ?? "");
  const [level, setLevel] = useState(team.level);
  const [color, setColor] = useState(team.logoColor);
  const [maxPlayers, setMaxPlayers] = useState(team.maxPlayers);
  const [homeVenueId, setHomeVenueId] = useState(String(team.homeVenueId ?? 0));
  const [code, setCode] = useState(team.teamCode ?? "");
  const [looking, setLooking] = useState(team.lookingForPlayers);
  const [newCaptainId, setNewCaptainId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [members, reqs, sent] = await Promise.all([
        fetchTeamRoster(team.id, captainId),
        fetchTeamRequests(team.id, captainId),
        fetchTeamInvites(team.id, captainId, "all"),
      ]);
      setRoster(members);
      setRequests(reqs);
      setInvites(sent.invites);
      if (sent.quota) setInviteQuota(sent.quota);
    } finally {
      setLoading(false);
    }
  }, [team.id, captainId]);

  useEffect(() => {
    void (async () => {
      await load();
      try {
        // role=player: venue owners run courts and admins run the platform, so
        // neither belongs in a squad. The server filters, and `candidates` below
        // filters again — see the Candidate type.
        const [venues, players] = await Promise.all([fetchVenues(), fetchPlayerDirectory()]);
        setVenueOptions(venues.map((v) => ({ id: v.id, name: v.name, city: v.city })));
        setPeople(players);
      } catch {
        /* the add-member search just stays empty */
      }
    })();
  }, [load]);

  /**
   * Run a mutation, then refresh every list and the parent's cards. Resolves to
   * whether it worked, so callers can clean up an input only after the server
   * actually accepted it.
   */
  async function act(
    key: string,
    run: () => Promise<Record<string, unknown>>,
    okMsg: string,
  ): Promise<boolean> {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await run();
      setNotice(okMsg);
      await load();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work 🛡️");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const decide = (requestId: number, action: "accept" | "decline", who: string) =>
    act(
      `req-${requestId}`,
      () => teamRequestAction({ teamId: team.id, captainId, requestId, action }),
      action === "accept" ? `${who} is in the squad 🎉` : `${who}'s request declined`,
    );

  /** Invite, never add — the player answers, and only that creates the roster row. */
  const sendInvite = async (userId: number, who: string) => {
    const ok = await act(
      `invite-${userId}`,
      () =>
        sendTeamInvite({
          teamId: team.id,
          captainId,
          userId,
          message: inviteNote.trim(),
        }),
      `${who} invited 📨 nothing changes until they say yes`,
    );
    if (ok) setInviteNote("");
  };

  const withdrawInvite = (inviteId: number, who: string) =>
    act(
      `withdraw-${inviteId}`,
      () => withdrawTeamInvite(team.id, captainId, inviteId),
      `Invite to ${who} withdrawn`,
    );

  const removeMember = (userId: number, who: string) =>
    act(
      `rm-${userId}`,
      () => removeTeamMember(team.id, captainId, userId),
      `${who} removed from the squad`,
    );

  const handOver = (userId: number, who: string) =>
    act(
      "transfer",
      () => updateTeam(team.id, { captainId, newCaptainId: userId }),
      `${who} captains ${team.name} now 👑`,
    );

  function saveDetails() {
    const errs: Record<string, string> = {};
    const nErr = validateTitle(name, { min: 3, max: 50, label: "Team name" });
    if (nErr) errs.name = nErr;
    if (motto.trim()) {
      const mErr = validateMessage(motto.trim(), { min: 3, max: 120, label: "Motto", required: false });
      if (mErr) errs.motto = mErr;
    }
    if (description.trim()) {
      const dErr = validateTeamDescription(description.trim());
      if (dErr) errs.description = dErr;
    }
    const cErr = validateTeamCode(code);
    if (cErr) errs.code = cErr;
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError(firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏");
      return;
    }
    void act(
      "save",
      () =>
        updateTeam(team.id, {
          captainId,
          name: name.trim(),
          motto: motto.trim(),
          // Sent trimmed-or-empty: clearing the box is a valid edit, so unlike the
          // create form this always includes the field.
          description: description.trim(),
          level,
          logoColor: color,
          maxPlayers: Number(maxPlayers),
          homeVenueId: Number(homeVenueId) || 0,
          teamCode: normalizeTeamCode(code),
          lookingForPlayers: looking,
        }),
      "Team details saved ✅",
    );
  }

  async function copyCode() {
    try {
      await Clipboard.setStringAsync(normalizeTeamCode(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const memberIds = useMemo(() => new Set(roster.map((m) => m.userId)), [roster]);
  const invitedIds = useMemo(
    () => new Set(invites.filter((i) => i.status === "pending").map((i) => i.userId)),
    [invites],
  );
  const pendingInvites = useMemo(() => invites.filter((i) => i.status === "pending"), [invites]);
  const answeredInvites = useMemo(() => invites.filter((i) => i.status !== "pending"), [invites]);
  /**
   * Everyone a captain may still reach out to: players only (belt and braces on
   * the server's `role=player` filter), not already on the roster, and without an
   * invitation of their own still waiting for an answer.
   */
  const candidates = useMemo(() => {
    const q = find.trim().toLowerCase();
    return people
      .filter((p) => !p.role || p.role === "player")
      .filter((p) => !memberIds.has(p.id) && !invitedIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 6);
  }, [people, memberIds, invitedIds, find]);
  const noInvitesLeft = inviteQuota.left <= 0;
  const transferTargets = roster.filter((m) => !m.isCaptain);
  const squadFull = roster.length >= maxPlayers;

  const goPlayer = (id: number) => router.push(`/players/${id}`);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.kav}
        >
          <View style={[styles.sheet, { backgroundColor: c.surface }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.head}>
                <View style={styles.headLeft}>
                  <View style={[styles.headIcon, { backgroundColor: color }]}>
                    <Shield size={20} color="#FFFFFF" />
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.headTitle, { color: c.text }]} numberOfLines={1}>
                      Manage {team.name}
                    </Text>
                    <Text style={[styles.headSub, { color: c.textMuted }]}>
                      <Crown size={12} color={tokens.amber400} /> You&apos;re the captain •{" "}
                      <Text style={styles.mono}>{normalizeTeamCode(code) || "no code"}</Text>
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                  style={[styles.close, { backgroundColor: c.inset }]}
                >
                  <X size={16} color={c.textMuted} />
                </Pressable>
              </View>

              {error ? (
                <Text style={[styles.banner, styles.bannerBad]}>{error}</Text>
              ) : notice ? (
                <Text style={[styles.banner, styles.bannerGood]}>{notice}</Text>
              ) : null}

              {loading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="large" color={c.primary} />
                </View>
              ) : (
                <View style={styles.sections}>
                  {/* ------------------------------------------ join requests */}
                  <View style={[styles.section, styles.amberSection]}>
                    <Text style={[styles.sectionTitle, styles.amberTitle]}>
                      <Users size={14} color="#B45309" /> Join requests
                      <Text style={styles.badgeAmber}> {requests.length}</Text>
                    </Text>
                    {requests.length === 0 ? (
                      <Text style={[styles.hint, { color: c.textMuted }]}>
                        Nobody waiting right now 🎉 Share your code{" "}
                        <Text style={styles.monoBlack}>{normalizeTeamCode(code)}</Text> so people
                        can find you.
                      </Text>
                    ) : (
                      <View style={styles.list}>
                        {requests.map((r) => (
                          <View key={r.id} style={[styles.rowCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                            <Pressable onPress={() => goPlayer(r.userId)}>
                              <Avatar
                                user={{ name: r.name, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl }}
                                size={36}
                              />
                            </Pressable>
                            <View style={styles.grow}>
                              <Pressable onPress={() => goPlayer(r.userId)}>
                                <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                                  {r.name}
                                </Text>
                              </Pressable>
                              <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                                {r.level} • {r.position}
                              </Text>
                              {r.message ? (
                                <Text style={[styles.rowMsg, { color: c.textMuted }]} numberOfLines={2}>
                                  “{r.message}”
                                </Text>
                              ) : null}
                            </View>
                            <Pressable
                              onPress={() => goPlayer(r.userId)}
                              style={[styles.ghostSm, { borderColor: c.border }]}
                            >
                              <ArrowUpRight size={14} color={c.textMuted} />
                              <Text style={[styles.ghostSmText, { color: c.textMuted }]}>Details</Text>
                            </Pressable>
                            <View style={styles.actionsRow}>
                              <Pressable
                                onPress={() => decide(r.id, "accept", r.name)}
                                disabled={busy === `req-${r.id}` || squadFull}
                                style={[styles.acceptBtn, squadFull || busy === `req-${r.id}` ? styles.dim : null]}
                              >
                                <Check size={14} color="#FFFFFF" />
                                <Text style={styles.acceptText}>Accept</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => decide(r.id, "decline", r.name)}
                                disabled={busy === `req-${r.id}`}
                                style={[styles.declineBtn, { borderColor: c.border }, busy === `req-${r.id}` ? styles.dim : null]}
                              >
                                <X size={14} color={c.textMuted} />
                                <Text style={[styles.declineText, { color: c.textMuted }]}>Decline</Text>
                              </Pressable>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                    {squadFull ? (
                      <Text style={styles.warnText}>
                        Squad is full ({roster.length}/{maxPlayers}) — raise the team size below
                        before accepting 👥
                      </Text>
                    ) : null}
                  </View>

                  {/* ------------------------------------------ roster */}
                  <View style={[styles.section, { borderColor: c.border }]}>
                    <Text style={[styles.sectionTitle, { color: tokens.emerald700 }]}>
                      <Shield size={14} color={tokens.emerald700} /> Squad • {roster.length}/
                      {maxPlayers}
                    </Text>
                    <View style={styles.list}>
                      {roster.map((m) => (
                        <View key={m.userId} style={[styles.memberRow, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}>
                          <Avatar
                            user={{ name: m.name, avatarColor: m.avatarColor, avatarUrl: m.avatarUrl }}
                            size={32}
                          />
                          <View style={styles.grow}>
                            <Pressable onPress={() => goPlayer(m.userId)} style={styles.inlineRow}>
                              <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                                {m.name}
                              </Text>
                              {m.isCaptain ? (
                                <Text style={styles.captainPill}>👑 Captain</Text>
                              ) : null}
                            </Pressable>
                            <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                              {m.level} • {m.position}
                              {m.email ? ` • ${m.email}` : ""}
                            </Text>
                          </View>
                          {m.isCaptain ? (
                            <Text style={[styles.rowMeta, { color: c.textFaint }]}>
                              {m.userId === captainId ? "that's you" : "captain"}
                            </Text>
                          ) : (
                            <Pressable
                              onPress={() => removeMember(m.userId, m.name)}
                              disabled={busy === `rm-${m.userId}`}
                              style={[styles.removeBtn, busy === `rm-${m.userId}` ? styles.dim : null]}
                            >
                              <UserX size={12} color={tokens.red600} />
                              <Text style={styles.removeText}>Remove</Text>
                            </Pressable>
                          )}
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* ------------------------------------------ invite players */}
                  <View style={[styles.section, { borderColor: c.border }]}>
                    <View style={styles.inlineBetween}>
                      <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
                        <Send size={14} color={c.textMuted} /> Invite a player
                      </Text>
                      <Text
                        style={[
                          styles.quotaPill,
                          {
                            backgroundColor: noInvitesLeft ? tokens.red100 : c.inset,
                          },
                        ]}
                      >
                        {inviteQuota.left}/{inviteQuota.limit} invites left today
                      </Text>
                    </View>
                    <Text style={[styles.hint, { color: c.textMuted }]}>
                      You can&apos;t drop anyone into a squad without their say-so 🛡️ — an invitation
                      waits until they accept or decline, so nobody ends up on a roster they never
                      agreed to. Players only: venue owners and staff aren&apos;t listed.
                    </Text>

                    {squadFull ? (
                      <Text style={styles.warnText}>
                        Squad is full ({roster.length}/{maxPlayers}) — raise the team size below
                        before inviting 👥
                      </Text>
                    ) : null}

                    <View style={[styles.searchWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                      <Search size={16} color={c.textFaint} />
                      <TextInput
                        value={find}
                        onChangeText={setFind}
                        placeholder="Search players by name or email…"
                        placeholderTextColor={c.textFaint}
                        autoCapitalize="none"
                        style={[styles.searchInput, { color: c.text }]}
                      />
                    </View>
                    <TextInput
                      value={inviteNote}
                      onChangeText={setInviteNote}
                      maxLength={200}
                      placeholder={'Optional note they see — e.g. "Training Tuesdays, we split the court bill"'}
                      placeholderTextColor={c.textFaint}
                      style={[styles.noteInput, { backgroundColor: inputFill, borderColor: c.border, color: c.text }]}
                    />
                    {candidates.length === 0 ? (
                      <Text style={[styles.hint, { color: c.textFaint }]}>
                        {find.trim()
                          ? "No player outside your squad matches that 🔍"
                          : "Every player on the platform is already in your squad or has an invite waiting 🎉"}
                      </Text>
                    ) : (
                      <View style={styles.list}>
                        {candidates.map((p) => {
                          const blocked = noInvitesLeft || squadFull;
                          return (
                            <View key={p.id} style={[styles.memberRow, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}>
                              <Avatar
                                user={{ name: p.name, avatarColor: p.avatarColor, avatarUrl: p.avatarUrl }}
                                size={32}
                              />
                              <View style={styles.grow}>
                                <Pressable onPress={() => goPlayer(p.id)}>
                                  <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                                    {p.name}
                                  </Text>
                                </Pressable>
                                <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                                  {p.level} • {p.position}
                                </Text>
                              </View>
                              <Pressable
                                onPress={() => void sendInvite(p.id, p.name)}
                                disabled={busy === `invite-${p.id}` || blocked}
                                style={[styles.inviteBtn, busy === `invite-${p.id}` || blocked ? styles.dim : null]}
                              >
                                {busy === `invite-${p.id}` ? (
                                  <Text style={styles.inviteText}>Sending…</Text>
                                ) : (
                                  <>
                                    <Plus size={12} color="#FFFFFF" />
                                    <Text style={styles.inviteText}>Invite</Text>
                                  </>
                                )}
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {pendingInvites.length > 0 ? (
                      <View style={[styles.subBox, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}>
                        <Text style={[styles.microTitle, { color: c.textFaint }]}>
                          <Hourglass size={12} color={c.textFaint} /> Waiting on their answer •{" "}
                          {pendingInvites.length}
                        </Text>
                        <View style={styles.list}>
                          {pendingInvites.map((i) => (
                            <View key={i.id} style={[styles.pendingRow, { backgroundColor: c.surface }]}>
                              <Avatar
                                user={{ name: i.name, avatarColor: i.avatarColor, avatarUrl: i.avatarUrl }}
                                size={28}
                              />
                              <View style={styles.grow}>
                                <Pressable onPress={() => goPlayer(i.userId)}>
                                  <Text style={[styles.rowNameSm, { color: c.text }]} numberOfLines={1}>
                                    {i.name}
                                  </Text>
                                </Pressable>
                                {i.message ? (
                                  <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                                    “{i.message}”
                                  </Text>
                                ) : null}
                              </View>
                              <Pressable
                                onPress={() => void withdrawInvite(i.id, i.name)}
                                disabled={busy === `withdraw-${i.id}`}
                                style={[styles.ghostXs, { borderColor: c.border }]}
                              >
                                <Text style={[styles.ghostXsText, { color: c.textMuted }]}>Withdraw</Text>
                              </Pressable>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {answeredInvites.length > 0 ? (
                      <View style={styles.historyToggleWrap}>
                        <Pressable
                          onPress={() => setShowInviteHistory((v) => !v)}
                          style={styles.historyToggle}
                        >
                          <MailQuestion size={12} color={c.textFaint} />
                          <Text style={[styles.historyToggleText, { color: c.textFaint }]}>
                            {showInviteHistory ? "Hide" : "Show"} answered invites •{" "}
                            {answeredInvites.length}
                          </Text>
                        </Pressable>
                        {showInviteHistory ? (
                          <View style={styles.list}>
                            {answeredInvites.map((i) => (
                              <View key={i.id} style={[styles.historyRow, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}>
                                <Text style={[styles.historyName, { color: c.textMuted }]} numberOfLines={1}>
                                  {i.name}
                                </Text>
                                <Text
                                  style={[
                                    styles.historyStatus,
                                    {
                                      backgroundColor:
                                        i.status === "accepted" ? tokens.emerald100 : c.inset,
                                      color:
                                        i.status === "accepted"
                                          ? tokens.emerald700
                                          : c.textMuted,
                                    },
                                  ]}
                                >
                                  {i.status}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  {/* ------------------------------------------ hand over */}
                  <View style={[styles.section, styles.amberSection]}>
                    <Text style={[styles.sectionTitle, styles.amberTitle]}>
                      <Crown size={14} color="#B45309" /> Hand over the armband
                    </Text>
                    <Text style={[styles.hint, { color: c.textMuted }]}>
                      A team always has exactly one captain. To step away, pass it to a member
                      first — then you&apos;ll be able to leave the squad like anyone else.
                    </Text>
                    {transferTargets.length === 0 ? (
                      <Text style={[styles.hint, { color: c.textFaint, fontWeight: "700" }]}>
                        No other members yet — add someone before you can hand over 👥
                      </Text>
                    ) : (
                      <View style={styles.transferRow}>
                        <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                          <Picker
                            selectedValue={newCaptainId}
                            onValueChange={(v) => setNewCaptainId(String(v))}
                            style={{ color: c.text }}
                          >
                            <Picker.Item label="Choose the next captain…" value="" />
                            {transferTargets.map((m) => (
                              <Picker.Item
                                key={m.userId}
                                label={`${m.name} — ${m.level} • ${m.position}`}
                                value={String(m.userId)}
                              />
                            ))}
                          </Picker>
                        </View>
                        <Pressable
                          onPress={() => {
                            const target = transferTargets.find(
                              (m) => String(m.userId) === newCaptainId,
                            );
                            if (target) void handOver(target.userId, target.name);
                          }}
                          disabled={!newCaptainId || busy === "transfer"}
                          style={[
                            styles.transferBtn,
                            !newCaptainId || busy === "transfer" ? styles.dim : null,
                          ]}
                        >
                          <Crown size={16} color="#FFFFFF" />
                          <Text style={styles.transferText}>Transfer</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>

                  {/* ------------------------------------------ details */}
                  <View style={[styles.section, { borderColor: c.border }]}>
                    <Text style={[styles.sectionTitle, { color: c.textMuted }]}>Team details</Text>
                    <View style={styles.form}>
                      <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Team name</Text>
                      <TextInput
                        value={name}
                        onChangeText={(t) => {
                          setName(t);
                          setFieldErrors((p) => ({ ...p, name: "" }));
                        }}
                        maxLength={50}
                        style={[
                          styles.input,
                          {
                            backgroundColor: inputFill,
                            borderColor: fieldErrors.name ? tokens.red400 : c.border,
                            color: c.text,
                          },
                        ]}
                      />
                      {fieldErrors.name ? (
                        <Text style={styles.fieldError}>{fieldErrors.name}</Text>
                      ) : null}

                      <Text style={[styles.fieldLabel, { color: c.textFaint }]}>
                        Unique code — how others find you
                      </Text>
                      <View style={styles.codeRow}>
                        <TextInput
                          value={code}
                          onChangeText={(t) => {
                            setCode(t.toUpperCase());
                            setFieldErrors((p) => ({ ...p, code: "" }));
                          }}
                          maxLength={24}
                          placeholder="CHARGERS-4X7K"
                          placeholderTextColor={c.textFaint}
                          autoCapitalize="characters"
                          style={[
                            styles.input,
                            styles.grow,
                            styles.monoInput,
                            {
                              backgroundColor: inputFill,
                              borderColor: fieldErrors.code ? tokens.red400 : c.border,
                              color: c.text,
                            },
                          ]}
                        />
                        <Pressable
                          onPress={() => setCode(suggestTeamCode(name || team.name))}
                          style={[styles.iconBtn, { borderColor: c.border }]}
                        >
                          <Dice5 size={16} color={c.textMuted} />
                        </Pressable>
                        <Pressable
                          onPress={() => void copyCode()}
                          style={[styles.iconBtn, { borderColor: c.border }]}
                        >
                          {copied ? (
                            <Check size={16} color={tokens.emerald600} />
                          ) : (
                            <Copy size={16} color={c.textMuted} />
                          )}
                        </Pressable>
                      </View>
                      {fieldErrors.code ? (
                        <Text style={styles.fieldError}>{fieldErrors.code}</Text>
                      ) : (
                        <Text style={[styles.hint, { color: c.textFaint }]}>
                          Letters, numbers and dashes • read it out loud and teammates can search it
                          🔍
                        </Text>
                      )}

                      <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Motto</Text>
                      <TextInput
                        value={motto}
                        onChangeText={(t) => {
                          setMotto(t);
                          setFieldErrors((p) => ({ ...p, motto: "" }));
                        }}
                        maxLength={120}
                        style={[
                          styles.input,
                          {
                            backgroundColor: inputFill,
                            borderColor: fieldErrors.motto ? tokens.red400 : c.border,
                            color: c.text,
                          },
                        ]}
                      />
                      {fieldErrors.motto ? (
                        <Text style={styles.fieldError}>{fieldErrors.motto}</Text>
                      ) : null}

                      <Text style={[styles.fieldLabel, { color: c.textFaint }]}>
                        About the squad — optional description
                      </Text>
                      <TextInput
                        value={description}
                        onChangeText={(t) => {
                          setDescription(t);
                          setFieldErrors((p) => ({ ...p, description: "" }));
                        }}
                        multiline
                        maxLength={TEAM_DESCRIPTION_MAX}
                        placeholder="Who plays, when you meet, how the court bill gets split — anything that helps a player decide to say yes."
                        placeholderTextColor={c.textFaint}
                        style={[
                          styles.input,
                          styles.textarea,
                          {
                            backgroundColor: inputFill,
                            borderColor: fieldErrors.description ? tokens.red400 : c.border,
                            color: c.text,
                          },
                        ]}
                      />
                      {fieldErrors.description ? (
                        <Text style={styles.fieldError}>{fieldErrors.description}</Text>
                      ) : (
                        <Text style={[styles.hint, { color: c.textFaint }]}>
                          {description.trim().length}/{TEAM_DESCRIPTION_MAX} • shown on your team
                          card and to anyone searching for a squad ✍️
                        </Text>
                      )}

                      <View style={styles.twoCol}>
                        <View style={styles.grow}>
                          <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Level</Text>
                          <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                            <Picker
                              selectedValue={level}
                              onValueChange={(v) => setLevel(String(v))}
                              style={{ color: c.text }}
                            >
                              {LEVELS.map((l) => (
                                <Picker.Item key={l} label={l} value={l} />
                              ))}
                            </Picker>
                          </View>
                        </View>
                        <View style={styles.grow}>
                          <Text style={[styles.fieldLabel, { color: c.textFaint }]}>
                            Team size • {roster.length} in squad
                          </Text>
                          <TextInput
                            value={String(maxPlayers)}
                            onChangeText={(t) => setMaxPlayers(Number(t) || 0)}
                            keyboardType="numeric"
                            style={[
                              styles.input,
                              { backgroundColor: inputFill, borderColor: c.border, color: c.text },
                            ]}
                          />
                        </View>
                      </View>

                      <Text style={[styles.fieldLabel, styles.fieldLabelRow, { color: c.textFaint }]}>
                        <MapPin size={12} color={c.textFaint} /> Home turf — venues on this platform
                      </Text>
                      <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                        <Picker
                          selectedValue={homeVenueId}
                          onValueChange={(v) => setHomeVenueId(String(v))}
                          style={{ color: c.text }}
                        >
                          <Picker.Item label="No home turf" value="0" />
                          {venueOptions.map((v) => (
                            <Picker.Item
                              key={v.id}
                              label={`${v.name} — ${v.city}`}
                              value={String(v.id)}
                            />
                          ))}
                        </Picker>
                      </View>
                      <Text style={[styles.hint, { color: c.textFaint }]}>
                        {venueOptions.length} venues to pick from — no typing, so it always matches
                        a real court 📍
                      </Text>

                      <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Colours</Text>
                      <View style={styles.swatches}>
                        {COLORS.map((sw) => (
                          <Pressable
                            key={sw}
                            onPress={() => setColor(sw)}
                            accessibilityLabel={sw}
                            style={[
                              styles.swatch,
                              {
                                backgroundColor: sw,
                                borderColor: color === sw ? tokens.emerald500 : "transparent",
                              },
                            ]}
                          />
                        ))}
                      </View>

                      <View style={[styles.lookRow, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}>
                        <Switch
                          value={looking}
                          onValueChange={setLooking}
                          trackColor={{ true: tokens.emerald500, false: tokens.stone300 }}
                          thumbColor="#FFFFFF"
                        />
                        <Text style={[styles.lookText, { color: c.text }]}>
                          Welcoming new friends — show this squad to people searching for a team
                        </Text>
                      </View>
                    </View>

                    <Pressable
                      onPress={saveDetails}
                      disabled={busy === "save"}
                      style={[styles.saveBtn, busy === "save" ? styles.dim : null]}
                    >
                      <Text style={styles.saveText}>
                        {busy === "save" ? "Saving…" : "Save changes ✅"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(28,25,23,0.5)", justifyContent: "flex-end" },
  kav: { maxHeight: "92%" },
  sheet: {
    borderTopLeftRadius: radius["3xl"],
    borderTopRightRadius: radius["3xl"],
    padding: space[5],
    paddingBottom: space[10],
  },
  grow: { flex: 1, minWidth: 0 },
  mono: { fontFamily: undefined, fontWeight: "700" },
  monoBlack: { fontWeight: "900" },
  monoInput: { letterSpacing: 1 },

  head: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  headLeft: { flexDirection: "row", alignItems: "center", gap: space[3], flex: 1, minWidth: 0 },
  headIcon: {
    width: 48,
    height: 48,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  headTitle: { fontSize: fontSize.xl, fontWeight: "900" },
  headSub: { fontSize: fontSize.sm, fontWeight: "700", marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },

  banner: {
    borderRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.xs,
    fontWeight: "700",
    marginTop: space[4],
  },
  bannerBad: { backgroundColor: tokens.red50, color: tokens.red600 },
  bannerGood: { backgroundColor: tokens.emerald50, color: tokens.emerald700 },

  loadingBox: { paddingVertical: space[10], alignItems: "center" },
  sections: { marginTop: space[5], gap: space[5] },

  section: { borderWidth: 1, borderRadius: radius["2xl"], padding: space[4] },
  amberSection: {
    borderColor: "#FCD34D",
    backgroundColor: "rgba(251,191,36,0.08)",
  },
  amberTitle: { color: "#B45309" },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  badgeAmber: {
    backgroundColor: tokens.amber400,
    color: "#FFFFFF",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 1,
    marginLeft: 4,
    fontSize: fontSize["2xs"],
  },
  hint: { fontSize: fontSize.xs, fontWeight: "600", marginTop: 8, lineHeight: 16 },
  warnText: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: "#B45309",
    marginTop: 8,
  },

  list: { marginTop: space[3], gap: space[2] },
  rowCard: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space[3],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
  },
  rowName: { fontSize: fontSize.base, fontWeight: "900" },
  rowNameSm: { fontSize: fontSize.sm, fontWeight: "700" },
  rowMeta: { fontSize: fontSize.xs, fontWeight: "600", marginTop: 1 },
  rowMsg: { fontSize: fontSize.xs, fontStyle: "italic", marginTop: 4 },
  actionsRow: { flexDirection: "row", gap: 6, marginLeft: "auto" },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: tokens.emerald600,
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  acceptText: { fontSize: fontSize.xs, fontWeight: "900", color: "#FFFFFF" },
  declineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  declineText: { fontSize: fontSize.xs, fontWeight: "900" },
  ghostSm: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  ghostSmText: { fontSize: fontSize["2xs"], fontWeight: "900" },

  memberRow: {
    borderRadius: radius.xl,
    paddingVertical: 8,
    paddingHorizontal: space[3],
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  captainPill: {
    fontSize: 9,
    fontWeight: "900",
    color: "#B45309",
    backgroundColor: "#FEF3C7",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: tokens.stone200,
    borderRadius: radius.lg,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  removeText: { fontSize: fontSize["2xs"], fontWeight: "900", color: tokens.red600 },

  inlineBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
    flexWrap: "wrap",
  },
  quotaPill: {
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: fontSize["2xs"],
    fontWeight: "900",
    color: tokens.stone600,
    overflow: "hidden",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    marginTop: space[3],
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: fontSize.base, fontWeight: "600" },
  noteInput: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    fontWeight: "600",
    marginTop: space[2],
    minHeight: 44,
  },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: tokens.emerald600,
    borderRadius: radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inviteText: { fontSize: fontSize["2xs"], fontWeight: "900", color: "#FFFFFF" },

  subBox: { borderRadius: radius.xl, padding: space[3], marginTop: space[3] },
  microTitle: {
    fontSize: fontSize["2xs"],
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pendingRow: {
    borderRadius: radius.xl,
    padding: space[2],
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  ghostXs: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  ghostXsText: { fontSize: 9, fontWeight: "900" },

  historyToggleWrap: { marginTop: space[3] },
  historyToggle: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyToggleText: {
    fontSize: fontSize["2xs"],
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  historyRow: {
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  historyName: { fontSize: fontSize.xs, fontWeight: "700", flex: 1 },
  historyStatus: {
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },

  transferRow: { flexDirection: "row", gap: space[2], marginTop: space[2], alignItems: "center" },
  pickerWrap: { borderWidth: 1, borderRadius: radius.xl, overflow: "hidden", minHeight: 44 },
  transferBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: tokens.amber400,
    borderRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingVertical: 12,
  },
  transferText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },

  form: { marginTop: space[3] },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: space[3],
    marginBottom: 6,
  },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  input: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    fontWeight: "600",
    minHeight: 44,
  },
  textarea: { minHeight: 96, textAlignVertical: "top" },
  fieldError: { fontSize: fontSize.xs, fontWeight: "700", color: tokens.red500, marginTop: 4 },
  codeRow: { flexDirection: "row", gap: space[2], alignItems: "center" },
  iconBtn: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  twoCol: { flexDirection: "row", gap: space[3] },

  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },

  lookRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius.xl,
    padding: space[3],
    marginTop: space[3],
  },
  lookText: { flex: 1, fontSize: fontSize.sm, fontWeight: "700" },

  saveBtn: {
    backgroundColor: tokens.emerald600,
    borderRadius: radius["2xl"],
    paddingVertical: 14,
    alignItems: "center",
    marginTop: space[4],
  },
  saveText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  dim: { opacity: 0.4 },
});
