import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import {
  Activity,
  Bell,
  CalendarCheck,
  CheckCheck,
  ChevronRight,
  Crown,
  HelpCircle,
  Lock,
  LogOut,
  MapPin,
  Moon,
  ShieldCheck,
  Sun,
  Trophy,
  User as UserIcon,
  Users,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { fetchNotifications, markAllNotificationsRead } from "@/api";
import { CITY_OPTIONS } from "@/lib/futsal";
import { timeAgo } from "@/lib/time";
import type { AppNotification } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Settings — a port of the web app's app/settings/page.tsx.
 *
 * Same six sections in the same order, same copy, same rows. The web version
 * uses a left rail that becomes a horizontal scroller on a phone; a phone-first
 * app only ever needs the scroller, so that is what this renders.
 *
 * Alerts are *listed* here but still owned by the bell — this panel shows the
 * unread count and a short preview, matching the original's split.
 */

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "appearance", label: "Appearance", icon: Sun },
  { id: "activity", label: "Your activity", icon: Activity },
  { id: "account", label: "Account", icon: ShieldCheck },
  { id: "help", label: "Help & about", icon: HelpCircle },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsScreen() {
  const { colors: c } = useTheme();
  const { mode, setMode, isDark } = useTheme();
  const { user, isOwner, signOut, updateProfile } = useAuth();
  const router = useRouter();

  const [section, setSection] = useState<SectionId>("profile");
  const [notes, setNotes] = useState<AppNotification[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [citySaving, setCitySaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadNotes = useCallback(async () => {
    if (!user) return;
    try {
      setNotes(await fetchNotifications(user.id));
    } catch {
      setNotes([]);
    }
    setNotesLoading(false);
  }, [user]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const unread = notes.filter((n) => !n.isRead).length;

  async function markAllRead() {
    if (!user) return;
    await markAllNotificationsRead(user.id);
    await loadNotes();
  }

  async function saveCity(defaultCity: string) {
    if (!user) return;
    setCitySaving(true);
    setMsg(null);
    try {
      await updateProfile({ defaultCity });
      setMsg({ ok: true, text: `Home city set to ${defaultCity}. Searches will start there. 🏠` });
    } catch {
      setMsg({ ok: false, text: "Could not save your home city — try again 🙏" });
    } finally {
      setCitySaving(false);
    }
  }

  if (!user) return null;

  const avatarUser = {
    name: user.name,
    avatarColor: (user as { avatarColor?: string }).avatarColor ?? colors.emerald600,
    avatarUrl: user.avatarUrl,
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: 16,
            maxWidth: 1280,
            width: "100%",
            alignSelf: "center",
          },
        ]}
      >
        {/* Heading */}
        <View style={styles.heading}>
          <Avatar user={avatarUser} size={56} />
          <View style={styles.grow}>
            <Text style={[styles.h1, { color: c.text }]}>Settings</Text>
            <Text style={[styles.subheading, { color: c.textMuted }]} numberOfLines={1}>
              {user.name} •{" "}
              {isOwner ? "Venue owner" : `${user.level ?? "Player"} • ${user.position ?? ""}`}
            </Text>
          </View>
        </View>

        {/* Section rail */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.rail}
          contentContainerStyle={styles.railContent}
        >
          {SECTIONS.map((s) => {
            const active = section === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSection(s.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.railItem,
                  active
                    ? { backgroundColor: colors.emerald600 }
                    : { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 },
                ]}
              >
                <s.icon size={16} color={active ? "#FFFFFF" : c.text} />
                <Text style={[styles.railText, { color: active ? "#FFFFFF" : c.text }]}>
                  {s.label}
                </Text>
                {s.id === "alerts" && unread > 0 ? (
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: active ? "#FFFFFF" : colors.red500 },
                    ]}
                  >
                    <Text
                      style={[styles.badgeText, { color: active ? colors.emerald700 : "#FFFFFF" }]}
                    >
                      {unread > 9 ? "9+" : unread}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        {msg ? (
          <Text
            style={[
              styles.msg,
              {
                backgroundColor: msg.ok ? colors.emerald50 : colors.red50,
                color: msg.ok ? colors.emerald700 : colors.red600,
              },
            ]}
          >
            {msg.text}
          </Text>
        ) : null}

        {/* ---------- PROFILE ---------- */}
        {section === "profile" ? (
          <>
            <PanelHead
              icon={UserIcon}
              title="Profile"
              text="How you look to other players, and where your games start."
            />
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.profileRow}>
                <Avatar user={avatarUser} size={64} />
                <View style={styles.grow}>
                  <Text style={[styles.profileName, { color: c.text }]} numberOfLines={1}>
                    {user.name}
                  </Text>
                  <Text style={[styles.profileEmail, { color: c.textMuted }]} numberOfLines={1}>
                    {user.email}
                  </Text>
                  <Text style={[styles.profileMeta, { color: c.textFaint }]}>
                    {isOwner
                      ? "👑 Venue owner account"
                      : `⚽ ${user.level ?? "—"} • ${user.position ?? "—"} • ${user.matchesPlayed ?? 0} games played`}
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
              <MapPin size={16} color={colors.emerald600} />
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: c.text }]}>Home city</Text>
                <Text style={[styles.rowSub, { color: c.textMuted }]}>
                  Court searches start here — change it any time.
                </Text>
              </View>
              <View style={[styles.cityPicker, { backgroundColor: c.inset, borderColor: c.border }]}>
                <Picker
                  selectedValue={(user as { defaultCity?: string }).defaultCity ?? "All Cities"}
                  onValueChange={(v) => void saveCity(v)}
                  enabled={!citySaving}
                  style={{ color: c.text, height: 40 }}
                  dropdownIconColor={c.textMuted}
                >
                  {CITY_OPTIONS.map((opt) => (
                    <Picker.Item key={opt} label={opt} value={opt} />
                  ))}
                </Picker>
              </View>
            </View>

            <Row
              icon={Lock}
              title="Avatar, level and position"
              sub={user.phone || "No phone number yet"}
              onPress={() => router.push("/profile")}
            />
          </>
        ) : null}

        {/* ---------- ALERTS ---------- */}
        {section === "alerts" ? (
          <>
            <PanelHead
              icon={Bell}
              title="Alerts"
              text="Confirmations, squad requests and league results. Everything is listed here."
            />
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.alertsCount, { color: c.text }]}>
                {unread > 0 ? `${unread} unread` : "All caught up 🎉"}
                <Text style={{ color: c.textFaint, fontWeight: "600" }}>  {notes.length} total</Text>
              </Text>
              <View style={styles.alertsActions}>
                {unread > 0 ? (
                  <Pressable
                    onPress={() => void markAllRead()}
                    style={[styles.smallButton, { borderColor: c.border }]}
                  >
                    <CheckCheck size={16} color={c.text} />
                    <Text style={[styles.smallButtonText, { color: c.text }]}>Mark all read</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => router.push("/notifications")}
                  style={[styles.smallButton, { backgroundColor: colors.emerald600, borderColor: colors.emerald600 }]}
                >
                  <Text style={[styles.smallButtonText, { color: "#FFFFFF" }]}>Open inbox</Text>
                  <ChevronRight size={16} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>

            {notesLoading ? null : notes.length === 0 ? (
              <View style={[styles.empty, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.emptyText, { color: c.textFaint }]}>
                  Nothing here yet. Book a court or join a game and the good news will land in this
                  inbox. ⚽
                </Text>
              </View>
            ) : (
              notes.slice(0, 6).map((n) => (
                <Pressable
                  key={n.id}
                  onPress={() => router.push("/notifications")}
                  style={[
                    styles.note,
                    n.isRead
                      ? { backgroundColor: c.surface, borderColor: c.border }
                      : { backgroundColor: colors.emerald50, borderColor: colors.emerald300 },
                  ]}
                >
                  <View style={styles.grow}>
                    <View style={styles.noteTitleRow}>
                      {!n.isRead ? <View style={styles.dot} /> : null}
                      <Text style={[styles.noteTitle, { color: c.text }]} numberOfLines={1}>
                        {n.title}
                      </Text>
                    </View>
                    {n.message ? (
                      <Text style={[styles.noteBody, { color: c.textMuted }]} numberOfLines={2}>
                        {n.message}
                      </Text>
                    ) : null}
                    <Text style={[styles.noteTime, { color: c.textFaint }]}>
                      {timeAgo(n.createdAt)}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={c.textFaint} />
                </Pressable>
              ))
            )}
          </>
        ) : null}

        {/* ---------- APPEARANCE ---------- */}
        {section === "appearance" ? (
          <>
            <PanelHead
              icon={Sun}
              title="Appearance"
              text="Day pitch or floodlights. Remembered on this device."
            />
            <View style={styles.themeRow}>
              {(
                [
                  { id: "light", label: "Light", text: "Sunny clubhouse", icon: Sun },
                  { id: "dark", label: "Dark", text: "Night game under lights", icon: Moon },
                ] as const
              ).map((t) => {
                // With mode="system", highlight whichever theme is actually resolved.
                const active =
                  mode === t.id ||
                  (mode === "system" && ((t.id === "dark") === isDark));
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setMode(t.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.themeCard,
                      {
                        borderColor: active ? colors.emerald500 : c.border,
                        backgroundColor: active ? colors.emerald50 : c.surface,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.themeIcon,
                        { backgroundColor: active ? colors.emerald600 : c.inset },
                      ]}
                    >
                      <t.icon size={20} color={active ? "#FFFFFF" : c.textMuted} />
                    </View>
                    <Text style={[styles.themeLabel, { color: c.text }]}>
                      {t.label} {active ? "✓" : ""}
                    </Text>
                    <Text style={[styles.themeText, { color: c.textMuted }]}>{t.text}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* ---------- ACTIVITY ---------- */}
        {section === "activity" ? (
          <>
            <PanelHead
              icon={Activity}
              title="Your activity"
              text="Everything you have booked, joined and entered."
            />
            <View style={styles.tileGrid}>
              <ActivityTile
                icon={CalendarCheck}
                title="My bookings"
                text="Court reservations and their status"
                onPress={() => router.push("/(app)/bookings")}
              />
              <ActivityTile
                icon={Zap}
                title="Open games"
                text="Friendly matches looking for players"
                onPress={() => router.push("/(app)/matches")}
              />
              <ActivityTile
                icon={Trophy}
                title="League matches"
                text="Squad competitions, tables and fixtures"
                onPress={() =>
                  router.push({ pathname: "/(app)/matches", params: { tab: "leagues" } })
                }
              />
              <ActivityTile
                icon={Users}
                title="Teams"
                text="Squads you can join or captain"
                onPress={() => router.push("/teams")}
              />
            </View>
            {!isOwner ? (
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.statGroupLabel, { color: c.textFaint }]}>On the pitch</Text>
                <View style={styles.statGrid}>
                  {[
                    { l: "Games played", v: `${user.matchesPlayed ?? 0}` },
                    { l: "Level", v: user.level ?? "—" },
                    { l: "Position", v: user.position ?? "—" },
                  ].map((s) => (
                    <View key={s.l} style={[styles.statTile, { backgroundColor: c.inset }]}>
                      <Text style={[styles.statValue, { color: c.text }]} numberOfLines={1}>
                        {s.v}
                      </Text>
                      <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        {/* ---------- ACCOUNT ---------- */}
        {section === "account" ? (
          <>
            <PanelHead
              icon={ShieldCheck}
              title="Account and security"
              text="Your sign-in details and how to leave the pitch."
            />
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <AccountRow label="Email" value={user.email} />
              <AccountRow label="Phone" value={user.phone || "—"} />
              <AccountRow label="Account type" value={isOwner ? "Venue owner" : "Player"} />
            </View>
            <Row
              icon={Lock}
              title="Change password"
              sub="Needs your current password to confirm it is really you."
              onPress={() => router.push("/profile")}
            />
            {isOwner ? (
              <Row
                icon={Crown}
                iconColor={colors.orange500}
                title="Owner Studio"
                sub="Venues, booking requests, leagues and revenue."
                onPress={() => router.push("/admin")}
              />
            ) : null}
            <Pressable
              onPress={() => void signOut()}
              accessibilityRole="button"
              style={[styles.logoutButton, { borderColor: colors.red200, backgroundColor: colors.red50 }]}
            >
              <LogOut size={16} color={colors.red600} />
              <Text style={[styles.logoutText, { color: colors.red600 }]}>
                Log out of FutsalNepal
              </Text>
            </Pressable>
          </>
        ) : null}

        {/* ---------- HELP ---------- */}
        {section === "help" ? (
          <>
            <PanelHead
              icon={HelpCircle}
              title="Help and about"
              text="The short version of how this place runs."
            />
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <HelpPara label="Booking." color={c.text}>
                A real person at the venue confirms every request — you will get an alert when they
                do.
              </HelpPara>
              <HelpPara label="Paying." color={c.text}>
                eSewa and Khalti run in test mode here, and cash at the counter is always fine.
              </HelpPara>
              <HelpPara label="Leagues." color={c.text}>
                A squad locks its place with at least a 25% deposit. Back out and 10% of what you
                paid comes back; the rest stays with the league.
              </HelpPara>
              <HelpPara label="Where things live." color={c.text}>
                League matches are inside the Matches screen. Alerts are behind the bell. Profile,
                theme and account are here.
              </HelpPara>
            </View>
            <Row
              icon={Trophy}
              title="Back to the home page"
              sub="FutsalNepal — made with 💚 for players, by players"
              onPress={() => router.push("/(app)")}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function PanelHead({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof UserIcon;
  title: string;
  text: string;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.panelHead}>
      <View style={[styles.panelHeadIcon, { backgroundColor: c.activeSoft }]}>
        <Icon size={20} color={c.activeText} />
      </View>
      <View style={styles.grow}>
        <Text style={[styles.panelHeadTitle, { color: c.text }]}>{title}</Text>
        <Text style={[styles.panelHeadText, { color: c.textMuted }]}>{text}</Text>
      </View>
    </View>
  );
}

function Row({
  icon: Icon,
  iconColor,
  title,
  sub,
  onPress,
}: {
  icon: typeof UserIcon;
  iconColor?: string;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Icon size={16} color={iconColor ?? colors.emerald600} />
      <View style={styles.grow}>
        <Text style={[styles.rowTitle, { color: c.text }]}>{title}</Text>
        <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <ChevronRight size={16} color={c.textFaint} />
    </Pressable>
  );
}

function ActivityTile({
  icon: Icon,
  title,
  text,
  onPress,
}: {
  icon: typeof UserIcon;
  title: string;
  text: string;
  onPress: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: c.inset }]}>
        <Icon size={20} color={c.activeText} />
      </View>
      <View style={styles.tileTitleRow}>
        <Text style={[styles.tileTitle, { color: c.text }]}>{title}</Text>
        <ChevronRight size={16} color={c.textFaint} />
      </View>
      <Text style={[styles.tileText, { color: c.textMuted }]}>{text}</Text>
    </Pressable>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.accountRow, { borderBottomColor: c.border }]}>
      <Text style={[styles.accountLabel, { color: c.textFaint }]}>{label}</Text>
      <Text style={[styles.accountValue, { color: c.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function HelpPara({
  label,
  children,
  color,
}: {
  label: string;
  children: string;
  color: string;
}) {
  const { colors: c } = useTheme();
  return (
    <Text style={[styles.helpPara, { color: c.textMuted }]}>
      <Text style={{ color, fontWeight: "900" }}>{label}</Text> {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[12] },

  heading: { flexDirection: "row", alignItems: "center", gap: space[4] },
  h1: { fontSize: fontSize["3xl"], fontWeight: "900" },
  subheading: { fontSize: fontSize.base, color: colors.stone500 },

  rail: { flexGrow: 0, marginTop: space[6] },
  railContent: { gap: space[2], paddingRight: space[4] },
  railItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  railText: { fontSize: fontSize.base, fontWeight: "700" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: fontSize["2xs"], fontWeight: "900" },

  msg: {
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.sm,
    fontWeight: "700",
    marginTop: space[4],
  },

  panelHead: { flexDirection: "row", alignItems: "flex-start", gap: space[3], marginTop: space[4] },
  panelHeadIcon: {
    width: 40,
    height: 40,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  panelHeadTitle: { fontSize: fontSize.xl, fontWeight: "900" },
  panelHeadText: { fontSize: fontSize.sm, lineHeight: 17, color: colors.stone500 },

  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
    marginTop: space[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: 14,
    marginTop: space[3],
  },
  rowTitle: { fontSize: fontSize.base, fontWeight: "900" },
  rowSub: { fontSize: fontSize.sm, color: colors.stone500 },

  profileRow: { flexDirection: "row", alignItems: "center", gap: space[4] },
  profileName: { fontSize: fontSize.lg, fontWeight: "900" },
  profileEmail: { fontSize: fontSize.sm, color: colors.stone500 },
  profileMeta: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 4 },

  cityPicker: {
    width: 144,
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },

  alertsCount: { fontSize: fontSize.base, fontWeight: "900" },
  alertsActions: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[3] },
  smallButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: space[2],
  },
  smallButtonText: { fontSize: fontSize.sm, fontWeight: "900" },

  empty: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[8],
    marginTop: space[3],
  },
  emptyText: { fontSize: fontSize.base, fontWeight: "600", textAlign: "center" },

  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    marginTop: space[2],
  },
  noteTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red500 },
  noteTitle: { fontSize: fontSize.base, fontWeight: "800", flexShrink: 1 },
  noteBody: { fontSize: fontSize.sm, lineHeight: 17, marginTop: 2 },
  noteTime: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 4 },

  themeRow: { flexDirection: "row", gap: space[3], marginTop: space[3] },
  themeCard: {
    flex: 1,
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
  },
  themeIcon: {
    width: 44,
    height: 44,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  themeLabel: { fontSize: fontSize.base, fontWeight: "900", marginTop: space[3] },
  themeText: { fontSize: fontSize.sm, color: colors.stone500 },

  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[3], marginTop: space[3] },
  tile: {
    flexGrow: 1,
    flexBasis: "47%",
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  tileTitleRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: space[3] },
  tileTitle: { fontSize: fontSize.base, fontWeight: "900" },
  tileText: { fontSize: fontSize.sm, lineHeight: 17, marginTop: 2 },

  statGroupLabel: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[3] },
  statTile: {
    flexGrow: 1,
    flexBasis: "30%",
    borderRadius: radius["2xl"],
    paddingHorizontal: space[3],
    paddingVertical: 10,
  },
  statValue: { fontSize: fontSize.base, fontWeight: "900" },
  statLabel: {
    fontSize: fontSize["2xs"],
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  accountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[4],
    borderBottomWidth: 1,
    paddingBottom: 10,
    marginBottom: 10,
  },
  accountLabel: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  accountValue: { flex: 1, textAlign: "right", fontSize: fontSize.base, fontWeight: "700" },

  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: 14,
    marginTop: space[3],
  },
  logoutText: { fontSize: fontSize.base, fontWeight: "900" },

  helpPara: { fontSize: fontSize.base, lineHeight: 21, marginBottom: space[3] },
});
