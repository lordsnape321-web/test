import { useRouter } from "expo-router";
import {
  Coins,
  Crown,
  Globe,
  ListFilter,
  Lock,
  Plus,
  Search,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fetchLeagues } from "@/api";
import { LeagueCard } from "@/components/LeagueCard";
import { LeagueForm } from "@/components/LeagueForm";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR } from "@/lib/futsal";
import type { LeagueSummary } from "@/lib/types";
import { validateSearch } from "@/lib/validation";
import { fontSize, radius, space } from "@/theme";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Taking entries" },
  { id: "mine", label: "My squads" },
  { id: "hosting", label: "I host" },
] as const;

type LeagueFilter = (typeof FILTERS)[number]["id"];

/**
 * League browser 🏆 — a 1:1 port of the web app's components/LeagueBrowser.tsx.
 *
 * The whole leagues listing, living inside the Matches screen as the second
 * half of the "Open games / League matches" toggle. Leagues are matches with a
 * table attached — asking a player to learn a separate top-level tab for them
 * was one tab too many, and on a phone the bottom rail was already out of room.
 *
 * Everything a league needs is still here: search, the four filters, hosting,
 * and the private-league rules. `/leagues/[id]` remains the detail page; the
 * old `/leagues` index redirects here so every bookmark, seeded notification
 * link and shared URL keeps working.
 *
 * Platform notes: the `Filter` icon is `ListFilter` in lucide-react-native;
 * the owner blurb's `/admin/leagues` link pushes `/admin` (the Owner Studio is
 * ported separately, same as settings already assumes).
 */
export function LeagueBrowser() {
  const { colors: c, isDark } = useTheme();
  const { user, isOwner } = useAuth();
  const router = useRouter();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<LeagueFilter>("all");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setLeagues(await fetchLeagues(user?.id));
    } catch {
      setLeagues([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = leagues;
    if (needle)
      rows = rows.filter((l) =>
        `${l.name} ${l.venueName} ${l.venueCity} ${l.format} ${l.hostName}`
          .toLowerCase()
          .includes(needle),
      );
    if (filter === "mine") rows = rows.filter((l) => (l.viewer?.myTeams.length ?? 0) > 0);
    if (filter === "hosting") rows = rows.filter((l) => l.viewer?.isHost);
    if (filter === "open")
      rows = rows.filter((l) => l.status === "registration" && l.approvedTeams < l.maxTeams);
    return rows;
  }, [leagues, q, filter]);

  const stats = useMemo(() => {
    const playing = leagues.reduce((s, l) => s + l.approvedTeams, 0);
    const pool = leagues.reduce((s, l) => s + l.prizePool, 0);
    return { count: leagues.length, playing, pool };
  }, [leagues]);

  function runSearch() {
    const err = validateSearch(draft, { max: 60 });
    if (err) {
      setNotice(err);
      return;
    }
    setNotice("");
    setQ(draft);
  }

  return (
    <View>
      {/* Intro band */}
      <LinearGradient
        colors={["#047857", "#065F46", "#1C1917"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.intro}
      >
        {/* the amber glow blob — no CSS blur, so a soft-edged circle stands in */}
        <View style={styles.introGlow} />
        <View style={styles.introInner}>
          <View style={styles.introCopy}>
            <View style={styles.kicker}>
              <Trophy size={14} color="#FCD34D" />
              <Text style={styles.kickerText}>LEAGUE MATCHES</Text>
            </View>
            <Text style={styles.introTitle}>
              One ground. Many squads. A table that actually means something.
            </Text>
            <Text style={styles.introSub}>
              Enter your squad, pay the deposit to lock your place, play the fixtures and watch
              the results land on your team profile. Hosting is open to players and venue owners
              alike.
            </Text>
            <View style={styles.introStats}>
              <View style={styles.introStat}>
                <Users size={14} color="rgba(167,243,208,0.8)" />
                <Text style={styles.introStatText}>{stats.playing} squads entered</Text>
              </View>
              <View style={styles.introStat}>
                <Trophy size={14} color="rgba(167,243,208,0.8)" />
                <Text style={styles.introStatText}>{stats.count} leagues</Text>
              </View>
              <View style={styles.introStat}>
                <Coins size={14} color="rgba(167,243,208,0.8)" />
                <Text style={styles.introStatText}>{formatNPR(stats.pool)} in prize pools</Text>
              </View>
            </View>
          </View>
          <Pressable
            onPress={() => (user ? setShowForm(true) : router.push("/login"))}
            accessibilityRole="button"
            style={({ pressed }) => [styles.hostBtn, { opacity: pressed ? 0.9 : 1 }]}
          >
            <Plus size={16} color="#422006" strokeWidth={3} />
            <Text style={styles.hostBtnText}>Host a league</Text>
          </Pressable>
        </View>
      </LinearGradient>

      {notice ? (
        <View
          style={[
            styles.notice,
            {
              backgroundColor: isDark ? "rgba(5,150,105,0.10)" : "#ECFDF5",
            },
          ]}
        >
          <Text style={[styles.noticeText, { color: isDark ? colorsSafe.emerald300 : "#047857" }]}>
            {notice}
          </Text>
        </View>
      ) : null}

      {/* Controls — stack on a phone, one row on wide screens */}
      <View style={styles.controls}>
        <View style={[styles.searchWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Search size={16} color="#A8A29E" style={styles.searchIcon} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            placeholder="Search leagues, grounds or hosts…"
            placeholderTextColor="#A8A29E"
            accessibilityLabel="Search leagues"
            style={[styles.searchInput, { color: c.text }]}
          />
        </View>
        <Pressable
          onPress={runSearch}
          accessibilityRole="button"
          style={({ pressed }) => [styles.searchBtn, { opacity: pressed ? 0.9 : 1 }]}
        >
          <Text style={styles.searchBtnText}>Search</Text>
        </Pressable>
        {/* The four filters used to overflow a 360px screen on the web; they
            scroll sideways here for the same reason. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={[styles.filterBarInner, { backgroundColor: c.surface }]}
        >
          <ListFilter size={14} color="#A8A29E" style={{ marginRight: 4 }} />
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => setFilter(f.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[
                  styles.filterChip,
                  on ? { backgroundColor: "#059669" } : null,
                ]}
              >
                <Text
                  style={[styles.filterChipText, { color: on ? "#FFFFFF" : c.textMuted }]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Hosting blurb for owners */}
      {isOwner ? (
        <View
          style={[
            styles.ownerBlurb,
            {
              borderColor: isDark ? "rgba(249,115,22,0.25)" : "#FED7AA",
              backgroundColor: isDark ? "rgba(249,115,22,0.10)" : "#FFF7ED",
            },
          ]}
        >
          <Crown size={14} color={isDark ? "#FDBA74" : "#C2410C"} />
          <Text style={[styles.ownerBlurbText, { color: isDark ? "#FDBA74" : "#C2410C" }]}>
            Running a venue? You can host leagues at your own ground straight from the Owner
            Studio — same tools, same table.{" "}
            <Text
              onPress={() => router.push("/admin")}
              style={styles.ownerBlurbLink}
            >
              Open Owner Studio → Leagues
            </Text>
          </Text>
        </View>
      ) : null}

      {/* Listing */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={[styles.loadingText, { color: c.textMuted }]}>Loading the league board…</Text>
        </View>
      ) : shown.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.emptyTitle, { color: c.text }]}>
            {q ? `No leagues match “${q}”` : "No leagues here yet"}
          </Text>
          <Text style={[styles.emptySub, { color: c.textMuted }]}>
            {q
              ? "Try the ground's name, or clear the search."
              : "Be the first to host one — it takes about two minutes. 🏆"}
          </Text>
          {q ? (
            <Pressable
              onPress={() => {
                setDraft("");
                setQ("");
                setNotice("");
              }}
              accessibilityRole="button"
              style={[styles.ghostBtn, { borderColor: c.border }]}
            >
              <Text style={[styles.ghostBtnText, { color: c.text }]}>Clear search</Text>
            </Pressable>
          ) : null}
          {user && !q ? (
            <Pressable
              onPress={() => setShowForm(true)}
              accessibilityRole="button"
              style={[styles.ghostBtn, { backgroundColor: "#059669", borderColor: "#059669" }]}
            >
              <Plus size={16} color="#FFFFFF" />
              <Text style={[styles.ghostBtnText, { color: "#FFFFFF" }]}>Host a league</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.grid}>
          {shown.map((l) => (
            <LeagueCard key={l.id} league={l} />
          ))}
        </View>
      )}

      {/* How it works */}
      <View style={styles.howRow}>
        {[
          {
            icon: Shield,
            title: "Deposit holds the place",
            text: "A squad pays at least 25% of the entry fee to be counted in. Back out and 10% of what was paid returns — the rest stays with the league.",
          },
          {
            icon: Users,
            title: "Invite or request",
            text: "Public leagues take join requests from captains. Private ones are invitation-only — invisible to everyone else.",
          },
          {
            icon: Trophy,
            title: "Results are the table",
            text: "The host enters the score after each game. It moves the table and lands on both squads' profiles automatically.",
          },
          {
            icon: Lock,
            title: "Photos stay inside",
            text: "Upload from your phone or paste a Drive link. Only the host and the squads that played see the pictures.",
          },
        ].map((s) => (
          <View key={s.title} style={[styles.howCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={[styles.howIcon, { backgroundColor: isDark ? "rgba(16,185,129,0.15)" : "#D1FAE5" }]}>
              <s.icon size={20} color={isDark ? "#6EE7B7" : "#047857"} />
            </View>
            <Text style={[styles.howTitle, { color: c.text }]}>{s.title}</Text>
            <Text style={[styles.howText, { color: c.textMuted }]}>{s.text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footerNote}>
        <Globe size={14} color="#A8A29E" />
        <Text style={[styles.footerNoteText, { color: c.textFaint }]}>
          Public leagues are listed for everyone •{" "}
        </Text>
        <Sparkles size={14} color="#A8A29E" />
        <Text style={[styles.footerNoteText, { color: c.textFaint }]}>
          private ones only for the squads invited
        </Text>
      </View>

      {user ? (
        <LeagueForm
          open={showForm}
          onClose={() => setShowForm(false)}
          hostId={user.id}
          onSaved={(id) => {
            setShowForm(false);
            if (id) router.push(`/leagues/${id}`);
            else void load();
          }}
        />
      ) : null}
    </View>
  );
}

/** Small helper so the notice text can use the palette even mid-render. */
const colorsSafe = { emerald300: "#6EE7B7" };

const styles = StyleSheet.create({
  intro: {
    borderRadius: radius["3xl"],
    padding: space["5"],
    overflow: "hidden",
    position: "relative",
  },
  introGlow: {
    position: "absolute",
    right: -64,
    top: -64,
    width: 224,
    height: 224,
    borderRadius: 112,
    backgroundColor: "rgba(252,211,77,0.20)",
  },
  introInner: { gap: space["4"], zIndex: 1 },
  introCopy: { gap: space["2"], maxWidth: 560 },
  kicker: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  kickerText: { fontSize: 11, fontWeight: "900", color: "#FCD34D", letterSpacing: 0.5 },
  introTitle: { fontSize: 26, fontWeight: "900", color: "#FFFFFF", lineHeight: 32, marginTop: 4 },
  introSub: { fontSize: 13, lineHeight: 20, color: "rgba(167,243,208,0.85)" },
  introStats: { flexDirection: "row", flexWrap: "wrap", gap: space["4"], marginTop: space["2"] },
  introStat: { flexDirection: "row", alignItems: "center", gap: 6 },
  introStatText: { fontSize: 11, fontWeight: "700", color: "rgba(167,243,208,0.8)" },
  hostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FBBF24",
    borderRadius: radius.xl,
    paddingHorizontal: 20,
    paddingVertical: 14,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
    alignSelf: "stretch",
  },
  hostBtnText: { fontSize: fontSize.base, fontWeight: "900", color: "#422006" },
  notice: {
    marginTop: space["4"],
    borderRadius: radius.xl,
    paddingHorizontal: space["4"],
    paddingVertical: 12,
  },
  noticeText: { fontSize: fontSize.sm, fontWeight: "700" },
  controls: { marginTop: space["5"], gap: space["2"] },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.xl,
    borderWidth: 1,
    minHeight: 48,
  },
  searchIcon: { position: "absolute", left: 14, zIndex: 1 },
  searchInput: {
    flex: 1,
    paddingHorizontal: 40,
    paddingVertical: 12,
    fontSize: fontSize.base,
    fontWeight: "600",
  },
  searchBtn: {
    backgroundColor: "#1C1917",
    borderRadius: radius.xl,
    paddingVertical: 13,
    alignItems: "center",
  },
  searchBtnText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  filterBar: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "#F0E3CC",
    flexGrow: 0,
  },
  filterBarInner: {
    alignItems: "center",
    gap: 4,
    padding: 4,
    borderRadius: radius.xl,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.lg,
  },
  filterChipText: { fontSize: 11, fontWeight: "900" },
  ownerBlurb: {
    marginTop: space["3"],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space["4"],
    paddingVertical: 12,
  },
  ownerBlurbText: { flex: 1, fontSize: fontSize.sm, fontWeight: "700", lineHeight: 18 },
  ownerBlurbLink: { textDecorationLine: "underline", fontWeight: "900" },
  loadingBox: { marginTop: space["6"], alignItems: "center", paddingVertical: space["8"] },
  loadingText: { marginTop: space["3"], fontSize: fontSize.sm, fontWeight: "600" },
  emptyCard: {
    marginTop: space["6"],
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space["8"],
    alignItems: "center",
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: "900", textAlign: "center" },
  emptySub: { marginTop: 4, fontSize: fontSize.sm, fontWeight: "600", textAlign: "center" },
  ghostBtn: {
    marginTop: space["4"],
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  ghostBtnText: { fontSize: fontSize.base, fontWeight: "900" },
  grid: { marginTop: space["6"], gap: space["4"] },
  howRow: {
    marginTop: space["8"],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space["3"],
  },
  howCard: {
    flexGrow: 1,
    flexBasis: 240,
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space["5"],
  },
  howIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  howTitle: { marginTop: space["3"], fontSize: fontSize.base, fontWeight: "900" },
  howText: { marginTop: 4, fontSize: fontSize.sm, lineHeight: 18 },
  footerNote: {
    marginTop: space["6"],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  footerNoteText: { fontSize: 11, fontWeight: "700" },
});
