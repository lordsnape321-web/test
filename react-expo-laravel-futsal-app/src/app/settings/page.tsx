"use client";
import { ThemedSelect } from "@/components/ThemedSelect";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  CalendarCheck,
  CheckCheck,
  ChevronRight,
  Crown,
  HelpCircle,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  ShieldCheck,
  Sun,
  Trophy,
  User as UserIcon,
  Users,
  Zap,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { useTheme } from "@/components/ThemeProvider";
import { Avatar } from "@/components/Avatar";
import { timeAgo } from "@/components/NotificationBell";
import { CITY_OPTIONS } from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

type Note = {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string | null;
};

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "appearance", label: "Appearance", icon: Sun },
  { id: "activity", label: "Your activity", icon: Activity },
  { id: "account", label: "Account", icon: ShieldCheck },
  { id: "help", label: "Help & about", icon: HelpCircle },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const ROW =
  "flex w-full items-center gap-3 rounded-2xl border border-[#F0E3CC] bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-emerald-300 dark:border-white/10 dark:bg-slate-900 dark:hover:border-emerald-500/50";

/**
 * Settings ⚙️ — one room for everything account shaped.
 *
 * Modelled on how Facebook does it: a rail of categories on the left, the chosen
 * one on the right, and nothing else competing for the top nav. It is where the
 * profile, the alerts inbox, the theme and the account controls now live, which
 * is what let the header and the bottom rail shed their "Alerts" tab and their
 * "Leagues" tab — those links are gathered here instead of being spread across
 * three places.
 *
 * Alerts are *listed* here but still owned by the bell: this panel shows the
 * unread count and a short preview, and the full inbox stays at /notifications,
 * reachable from the bell or from the button below.
 */
export default function SettingsPage() {
  const { user, loading: authLoading, isOwner, logout, updateProfile } = useUser();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [section, setSection] = useState<SectionId>("profile");
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [citySaving, setCitySaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadNotes = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/api/notifications?userId=${user.id}`);
      const data = await res.json();
      setNotes(data.notifications ?? []);
    } catch {
      setNotes([]);
    }
    // Deliberately *not* in a `finally`: an early `return` still runs `finally`,
    // so the logged-out path would have called setState synchronously inside the
    // mount effect. After an `await` it is a normal async update.
    setNotesLoading(false);
  }, [user]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const unread = notes.filter((n) => !n.isRead).length;

  async function markAllRead() {
    if (!user) return;
    await apiFetch("/api/notifications/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
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

  function handleLogout() {
    logout();
    router.push("/");
  }

  /* --- logged out ------------------------------------------------------ */
  if (!authLoading && !user) {
    return (
      <main className="turf-pattern grid min-h-screen place-items-center px-4 py-12">
        <div className="w-full max-w-md rounded-[2rem] border border-[#F0E3CC] bg-white p-8 text-center shadow-lg dark:border-white/10 dark:bg-slate-900">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 dark:bg-emerald-500/15">
            <ShieldCheck className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          </span>
          <h1 className="mt-4 text-2xl font-black text-stone-900 dark:text-slate-100">
            Settings are for your account
          </h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-slate-400">
            Log in to reach your profile, alerts, theme and account controls — all
            in one place.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white shadow-md"
            >
              <LogIn className="h-4 w-4" /> Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-2xl border border-stone-200 py-3 text-sm font-black text-stone-700 dark:border-white/10 dark:text-slate-200"
            >
              Join free
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="turf-pattern min-h-screen">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <div className="h-24 animate-pulse rounded-3xl bg-white dark:bg-slate-900" />
        </div>
      </main>
    );
  }

  const profileHref = isOwner ? "/admin/profile" : "/profile";

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Heading */}
        <div className="flex flex-wrap items-center gap-4">
          <Avatar user={user} className="h-14 w-14 text-base" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black text-stone-900 sm:text-3xl dark:text-slate-100">
              Settings
            </h1>
            <p className="truncate text-sm text-stone-500 dark:text-slate-400">
              {user.name} • {isOwner ? "Venue owner" : `${user.level} • ${user.position}`}
            </p>
          </div>
        </div>

        <div className="mt-6 gap-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
          {/* Rail — a horizontal scroller on a phone, a sidebar from `lg` up */}
          <nav aria-label="Settings sections">
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:sticky lg:top-24 lg:flex-col lg:overflow-visible lg:px-0">
              {SECTIONS.map((s) => {
                const active = section === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSection(s.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex shrink-0 items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-bold transition lg:w-full ${
                      active
                        ? "bg-emerald-600 text-white shadow-md"
                        : "border border-[#F0E3CC] bg-white text-stone-700 hover:bg-orange-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5"
                    }`}
                  >
                    <s.icon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">{s.label}</span>
                    {s.id === "alerts" && unread > 0 && (
                      <span
                        className={`ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[10px] font-black ${
                          active ? "bg-white text-emerald-700" : "bg-red-500 text-white"
                        }`}
                      >
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </button>
                );
              })}
              {isOwner && (
                <Link
                  href="/admin"
                  className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700 transition hover:bg-orange-100 lg:w-full dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300"
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Owner Studio</span>
                </Link>
              )}
            </div>
          </nav>

          {/* Panel */}
          <div className="mt-4 min-w-0 lg:mt-0">
            {msg && (
              <p
                className={`mb-4 rounded-2xl px-4 py-3 text-xs font-bold ${
                  msg.ok
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                }`}
              >
                {msg.text}
              </p>
            )}

            {/* ---------- PROFILE ---------- */}
            {section === "profile" && (
              <section className="space-y-3">
                <PanelHead
                  icon={UserIcon}
                  title="Profile"
                  text="How you look to other players, and where your games start."
                />
                <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center gap-4">
                    <Avatar user={user} className="h-16 w-16 text-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-black text-stone-900 dark:text-slate-100">
                        {user.name}
                      </p>
                      <p className="truncate text-xs text-stone-500 dark:text-slate-400">{user.email}</p>
                      <p className="mt-1 text-[11px] font-bold text-stone-400 dark:text-slate-500">
                        {isOwner
                          ? "👑 Venue owner account"
                          : `⚽ ${user.level} • ${user.position} • ${user.matchesPlayed} games played`}
                      </p>
                    </div>
                    <Link
                      href={profileHref}
                      className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700"
                    >
                      Edit profile <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>

                <label className={ROW}>
                  <MapPin className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-stone-900 dark:text-slate-100">
                      Home city
                    </span>
                    <span className="block text-xs text-stone-500 dark:text-slate-400">
                      Court searches start here — change it any time.
                    </span>
                  </span>
                  <ThemedSelect
                    value={user.defaultCity ?? "All Cities"}
                    disabled={citySaving}
                    onChange={(e) => void saveCity(e.target.value)}
                    aria-label="Home city"
                    className="w-36 shrink-0 rounded-xl border border-stone-200 bg-[#FFF6E9] px-2.5 py-2 text-xs font-bold text-stone-900 focus:border-emerald-500 focus:outline-none disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                  >
                    {CITY_OPTIONS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </ThemedSelect>
                </label>

                <Link href={profileHref} className={ROW}>
                  <Lock className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-stone-900 dark:text-slate-100">
                      Avatar, level and position
                    </span>
                    <span className="block truncate text-xs text-stone-500 dark:text-slate-400">
                      {user.phone || "No phone number yet"}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
                </Link>
              </section>
            )}

            {/* ---------- ALERTS ---------- */}
            {section === "alerts" && (
              <section className="space-y-3">
                <PanelHead
                  icon={Bell}
                  title="Alerts"
                  text="Confirmations, squad requests and league results. The bell in the top bar is the quick way in — everything is listed here too."
                />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[#F0E3CC] bg-white px-5 py-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <p className="text-sm font-black text-stone-900 dark:text-slate-100">
                    {unread > 0 ? `${unread} unread` : "All caught up 🎉"}
                    <span className="ml-2 text-xs font-semibold text-stone-400 dark:text-slate-500">
                      {notes.length} total
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unread > 0 && (
                      <button
                        onClick={() => void markAllRead()}
                        className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-3.5 py-2 text-xs font-black text-stone-700 transition hover:bg-stone-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
                      >
                        <CheckCheck className="h-4 w-4" /> Mark all read
                      </button>
                    )}
                    <Link
                      href={isOwner ? "/admin/notifications" : "/notifications"}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-emerald-700"
                    >
                      Open inbox <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>

                {notesLoading ? (
                  <div className="space-y-2.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-16 animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
                    ))}
                  </div>
                ) : notes.length === 0 ? (
                  <p className="rounded-3xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm font-semibold text-stone-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-500">
                    Nothing here yet. Book a court or join a game and the good news
                    will land in this inbox. ⚽
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {notes.slice(0, 6).map((n) => (
                      <Link
                        key={n.id}
                        href={n.link || (isOwner ? "/admin/notifications" : "/notifications")}
                        className={`flex items-start gap-3 rounded-2xl border p-4 shadow-sm transition ${
                          n.isRead
                            ? "border-[#F0E3CC] bg-white dark:border-white/10 dark:bg-slate-900"
                            : "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {!n.isRead && (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                            )}
                            <span className="truncate text-sm font-extrabold text-stone-900 dark:text-slate-100">
                              {n.title}
                            </span>
                          </span>
                          {n.message && (
                            <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-stone-500 dark:text-slate-400">
                              {n.message}
                            </span>
                          )}
                          <span className="mt-1 block text-[11px] font-bold text-stone-400 dark:text-slate-500">
                            {timeAgo(n.createdAt)}
                          </span>
                        </span>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-stone-300 dark:text-slate-600" />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ---------- APPEARANCE ---------- */}
            {section === "appearance" && (
              <section className="space-y-3">
                <PanelHead
                  icon={Sun}
                  title="Appearance"
                  text="Day pitch or floodlights. Remembered on this device."
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      { id: "light", label: "Light", text: "Sunny clubhouse", icon: Sun },
                      { id: "dark", label: "Dark", text: "Night game under lights", icon: Moon },
                    ] as const
                  ).map((t) => {
                    const active = theme === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        aria-pressed={active}
                        className={`rounded-3xl border p-5 text-left shadow-sm transition ${
                          active
                            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                            : "border-[#F0E3CC] bg-white hover:border-emerald-300 dark:border-white/10 dark:bg-slate-900"
                        }`}
                      >
                        <span
                          className={`grid h-11 w-11 place-items-center rounded-2xl ${
                            active
                              ? "bg-emerald-600 text-white"
                              : "bg-[#FFF6E9] text-stone-500 dark:bg-white/5 dark:text-slate-400"
                          }`}
                        >
                          <t.icon className="h-5 w-5" />
                        </span>
                        <span className="mt-3 block text-sm font-black text-stone-900 dark:text-slate-100">
                          {t.label} {active && "✓"}
                        </span>
                        <span className="block text-xs text-stone-500 dark:text-slate-400">{t.text}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ---------- ACTIVITY ---------- */}
            {section === "activity" && (
              <section className="space-y-3">
                <PanelHead
                  icon={Activity}
                  title="Your activity"
                  text="Everything you have booked, joined and entered."
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <ActivityTile
                    href="/bookings"
                    icon={CalendarCheck}
                    title="My bookings"
                    text="Court reservations and their status"
                  />
                  <ActivityTile
                    href="/matches"
                    icon={Zap}
                    title="Open games"
                    text="Friendly matches looking for players"
                  />
                  <ActivityTile
                    href="/matches?tab=leagues"
                    icon={Trophy}
                    title="League matches"
                    text="Squad competitions, tables and fixtures"
                  />
                  <ActivityTile
                    href="/teams"
                    icon={Users}
                    title="Teams"
                    text="Squads you can join or captain"
                  />
                </div>
                {!isOwner && (
                  <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
                    <p className="text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                      On the pitch
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {[
                        { l: "Games played", v: `${user.matchesPlayed}` },
                        { l: "Level", v: user.level },
                        { l: "Position", v: user.position },
                      ].map((s) => (
                        <div key={s.l} className="rounded-2xl bg-[#FFF6E9] px-3 py-2.5 dark:bg-white/5">
                          <p className="truncate text-sm font-black text-stone-900 dark:text-slate-100">
                            {s.v}
                          </p>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-slate-500">
                            {s.l}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ---------- ACCOUNT ---------- */}
            {section === "account" && (
              <section className="space-y-3">
                <PanelHead
                  icon={ShieldCheck}
                  title="Account and security"
                  text="Your sign-in details and how to leave the pitch."
                />
                <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <dl className="space-y-2.5 text-sm">
                    <AccountRow label="Email" value={user.email} />
                    <AccountRow label="Phone" value={user.phone || "—"} />
                    <AccountRow label="Account type" value={isOwner ? "Venue owner" : "Player"} />
                  </dl>
                </div>
                <Link href={profileHref} className={ROW}>
                  <Lock className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-stone-900 dark:text-slate-100">
                      Change password
                    </span>
                    <span className="block text-xs text-stone-500 dark:text-slate-400">
                      Needs your current password to confirm it is really you.
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
                </Link>
                {isOwner && (
                  <Link href="/admin" className={ROW}>
                    <Crown className="h-4 w-4 shrink-0 text-orange-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-black text-stone-900 dark:text-slate-100">
                        Owner Studio
                      </span>
                      <span className="block text-xs text-stone-500 dark:text-slate-400">
                        Venues, booking requests, leagues and revenue.
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 text-left text-sm font-black text-red-600 transition hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/15"
                >
                  <LogOut className="h-4 w-4 shrink-0" /> Log out of FutsalNepal
                </button>
              </section>
            )}

            {/* ---------- HELP ---------- */}
            {section === "help" && (
              <section className="space-y-3">
                <PanelHead
                  icon={HelpCircle}
                  title="Help and about"
                  text="The short version of how this place runs."
                />
                <div className="space-y-3 rounded-3xl border border-[#F0E3CC] bg-white p-5 text-sm leading-relaxed text-stone-600 shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">
                  <p>
                    <strong className="text-stone-900 dark:text-slate-100">Booking.</strong> A
                    real person at the venue confirms every request — you will get an alert when
                    they do.
                  </p>
                  <p>
                    <strong className="text-stone-900 dark:text-slate-100">Paying.</strong> eSewa
                    and Khalti run in test mode here, and cash at the counter is always fine.
                  </p>
                  <p>
                    <strong className="text-stone-900 dark:text-slate-100">Leagues.</strong> A
                    squad locks its place with at least a 25% deposit. Back out and 10% of what
                    you paid comes back; the rest stays with the league.
                  </p>
                  <p>
                    <strong className="text-stone-900 dark:text-slate-100">Where things live.</strong>{" "}
                    League matches are inside the Matches screen. Alerts are behind the bell.
                    Profile, theme and account are here.
                  </p>
                </div>
                <Link href="/" className={ROW}>
                  <Trophy className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-stone-900 dark:text-slate-100">
                      Back to the home page
                    </span>
                    <span className="block text-xs text-stone-500 dark:text-slate-400">
                      FutsalNepal — made with 💚 for players, by players
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
                </Link>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function PanelHead({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof UserIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-black text-stone-900 dark:text-slate-100">{title}</h2>
        <p className="text-xs leading-relaxed text-stone-500 dark:text-slate-400">{text}</p>
      </div>
    </div>
  );
}

function ActivityTile({
  href,
  icon: Icon,
  title,
  text,
}: {
  href: string;
  icon: typeof UserIcon;
  title: string;
  text: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm transition hover:border-emerald-300 dark:border-white/10 dark:bg-slate-900 dark:hover:border-emerald-500/50"
    >
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#FFF6E9] text-emerald-700 dark:bg-white/5 dark:text-emerald-300">
        <Icon className="h-5 w-5" />
      </span>
      <span className="mt-3 flex items-center gap-1 text-sm font-black text-stone-900 dark:text-slate-100">
        {title} <ChevronRight className="h-4 w-4 text-stone-300 dark:text-slate-600" />
      </span>
      <span className="mt-0.5 block text-xs leading-relaxed text-stone-500 dark:text-slate-400">
        {text}
      </span>
    </Link>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-stone-100 pb-2.5 last:border-0 last:pb-0 dark:border-white/5">
      <dt className="text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate text-right text-sm font-bold text-stone-800 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}
