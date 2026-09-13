"use client";

import { useEffect, useState } from "react";
import { Plus, MapPin, CalendarDays, X, Zap, Check, HandHeart, Minus, Shield } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { type MatchItem } from "@/components/cards";
import { Avatar } from "@/components/Avatar";
import {
  formatNPR,
  formatTime12,
  prettyDate,
  todayISO,
} from "@/lib/futsal";
import { validateTitle, validateMessage, validateMoney, validateDateISO, validateTimeHM, firstError } from "@/lib/validation";

type Venue = { id: number; name: string; courts?: Array<{ id: number; name: string }> };
type UserTeam = { id: number; name: string; memberCount: number; logoColor: string };

const LEVEL_OPTIONS = [
  { name: "Beginner", emoji: "🌱" },
  { name: "Intermediate", emoji: "⚡" },
  { name: "Advanced", emoji: "🔥" },
];

export default function MatchesPage() {
  const { user } = useUser();
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [showCreate, setShowCreate] = useState(false);
  const [joining, setJoining] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [venueId, setVenueId] = useState("");
  const [date, setDate] = useState(todayISO(1));
  const [start, setStart] = useState("18:00");
  const [price, setPrice] = useState(200);
  const [ourCrew, setOurCrew] = useState(5);
  const [openSpots, setOpenSpots] = useState(5);
  const [welcomeMode, setWelcomeMode] = useState<"any" | "specific">("any");
  const [welcomeLevels, setWelcomeLevels] = useState<string[]>([]);
  const [userTeams, setUserTeams] = useState<UserTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = async () => {
    const [mRes, vRes, tRes] = await Promise.all([
      fetch("/api/matches"),
      fetch("/api/venues"),
      fetch("/api/teams"),
    ]);
    const m = await mRes.json();
    const v = await vRes.json();
    const t = await tRes.json();
    setMatches(m.matches ?? []);
    setVenues(v.venues ?? []);
    if (!venueId && (v.venues ?? []).length > 0) setVenueId(String(v.venues[0].id));
    if (user) {
      const mine = ((t.teams ?? []) as Array<UserTeam & { players: Array<{ id: number }> }>).filter(
        (x) => x.players?.some((p) => p.id === user.id)
      );
      setUserTeams(mine);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/seed", { method: "POST" });
        await load();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smart filter: a specific level shows "All Levels" games too (they welcome everyone),
  // plus games that explicitly include that level.
  const filtered = matches.filter((m) => {
    if (filter === "All") return true;
    if (filter === "All Levels") return m.level === "All Levels";
    return m.level === "All Levels" || m.level.includes(filter);
  });

  function pickTeam(teamId: string) {
    setSelectedTeam(teamId);
    if (!teamId) return;
    const t = userTeams.find((x) => String(x.id) === teamId);
    if (t) setOurCrew(Math.min(21, Math.max(1, t.memberCount || 1)));
  }

  function toggleLevel(name: string) {
    setWelcomeLevels((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]
    );
  }

  const totalPlayers = ourCrew + openSpots;
  const levelString =
    welcomeMode === "any" || welcomeLevels.length === 0
      ? "All Levels"
      : welcomeLevels.join(" + ");

  async function toggleJoin(m: MatchItem) {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    const already = (m.players ?? []).some((p) => p.id === user.id);
    setJoining(m.id);
    try {
      if (already) {
        await fetch(`/api/matches/${m.id}/join?userId=${user.id}`, { method: "DELETE" });
      } else {
        const res = await fetch(`/api/matches/${m.id}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setJoining(null);
    }
  }

  async function createMatch() {
    if (!user || !venueId) return;
    const errs: Record<string, string> = {};
    const tErr = validateTitle(title, { min: 3, max: 60, label: "Game title" });
    if (tErr) errs.title = tErr;
    const dErr = validateDateISO(date, { label: "Game day", maxDaysAhead: 60 });
    if (dErr) errs.date = dErr;
    const sErr = validateTimeHM(start, "Start time");
    if (sErr) errs.start = sErr;
    const pErr = validateMoney(price, { min: 0, max: 2000, label: "Price per friend" });
    if (pErr) errs.price = pErr;
    if (desc.trim()) {
      const mErr = validateMessage(desc.trim(), { min: 3, max: 500, label: "Note", required: false });
      if (mErr) errs.desc = mErr;
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setFormError(firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏");
      return;
    }
    if (openSpots < 1) {
      setFormError("Open at least 1 spot for others 🙋");
      return;
    }
    if (totalPlayers < 4 || totalPlayers > 22) {
      setFormError("Total players must be between 4 and 22 🤝");
      return;
    }
    if (welcomeMode === "specific" && welcomeLevels.length === 0) {
      setFormError("Pick at least one level — or choose Anyone 🌍");
      return;
    }
    setFieldErrors({});
    setCreating(true);
    setFormError("");
    try {
      const [h] = start.split(":").map(Number);
      const end = `${String(h + 1).padStart(2, "0")}:00`;
      const venue = venues.find((v) => v.id === Number(venueId));
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          venueId: Number(venueId),
          courtId: venue?.courts?.[0]?.id,
          organizerId: user.id,
          date,
          startTime: start,
          endTime: end,
          pricePerPlayer: price,
          maxPlayers: totalPlayers,
          crewSize: ourCrew,
          openSpots,
          chargeMode: "custom",
          level: levelString,
          description:
            desc.trim() ||
            `👥 ${ourCrew} from our crew • 🙋 ${openSpots} open for you! Come join the fun 🤝`,
        }),
      });
      if (!res.ok) throw new Error("Failed to create");
      setShowCreate(false);
      setTitle("");
      setDesc("");
      setWelcomeLevels([]);
      setWelcomeMode("any");
      setSelectedTeam("");
      await load();
    } catch {
      setFormError("Could not share your game — try again 🙏");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
              <HandHeart className="h-3.5 w-3.5" /> Come as you are
            </p>
            <h1 className="mt-1 text-3xl font-black text-stone-900 dark:text-stone-100">Games looking for you</h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {matches.length} friendly games this week • everyone gets a warm welcome
            </p>
          </div>
          <button
            onClick={() => (user ? setShowCreate(true) : (window.location.href = "/login"))}
            className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-md transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" strokeWidth={3} /> Start a game
          </button>
        </div>

        <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1">
          {["All", "Beginner", "Intermediate", "Advanced"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-black transition ${
                filter === f
                  ? "bg-emerald-600 text-white shadow-md"
                  : "border border-stone-200 bg-white text-stone-600 shadow-sm hover:bg-orange-50 dark:border-white/10 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-white/5"
              }`}
            >
              {f === "All" ? "🌍 Everyone" : f === "Beginner" ? "🌱 Beginner" : f === "Intermediate" ? "⚡ Intermediate" : "🔥 Advanced"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
          Tip: level filters also show “Anyone welcome” games — they&apos;re open to you too! 💛
        </p>

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-64 animate-pulse rounded-3xl bg-white dark:bg-stone-900" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center dark:border-white/20 dark:bg-stone-900">
            <Zap className="mx-auto h-10 w-10 text-stone-300 dark:text-stone-600" />
            <h3 className="mt-3 text-lg font-extrabold text-stone-900 dark:text-stone-100">Quiet here for now</h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Be the first to start a game — friends will follow!</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {filtered.map((m) => {
              const already = (m.players ?? []).some((p) => p.id === user?.id);
              const full = m.spotsLeft === 0 && !already;
              const pct = Math.round((m.joinedCount / Math.max(1, m.maxPlayers)) * 100);
              const crew = m.crewSize ?? 1;
              const others = m.otherJoined ?? Math.max(0, m.joinedCount - crew);
              return (
                <div
                  key={m.id}
                  className="overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-[0_10px_30px_rgba(180,120,60,0.08)] transition hover:border-emerald-300 dark:border-white/10 dark:bg-stone-900 dark:hover:border-emerald-500/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-extrabold text-stone-900 dark:text-stone-100">{m.title}</h3>
                      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                        hosted with 💚 by {m.organizer?.name ?? "a friend"} •{" "}
                        {m.level === "All Levels" ? "🌍 Anyone welcome" : `🎯 ${m.level}`}
                      </p>
                      <p className="mt-1 text-[11px] font-bold text-stone-400 dark:text-stone-500">
                        👥 {crew} crew • 🙋 {others} joined from outside
                      </p>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {m.bookingId ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            ✓ Court already sorted
                          </span>
                        ) : null}
                        {(m.chargeMode ?? (m.bookingId ? "split" : "custom")) === "custom" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-black text-violet-700 dark:text-violet-300">
                            ✨ Custom {formatNPR(m.pricePerPlayer)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-black text-sky-700 dark:text-sky-300">
                            🤝 Fair split
                          </span>
                        )}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                        full
                          ? "bg-stone-200 text-stone-500 dark:bg-white/10 dark:text-stone-400"
                          : "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
                      }`}
                    >
                      {full ? "Full house" : `${m.spotsLeft} left`}
                    </span>
                  </div>
                  {m.description && (
                    <p className="mt-2 text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
                      {m.description}
                    </p>
                  )}
                  <div className="mt-3 space-y-1.5 text-[13px] font-semibold text-stone-600 dark:text-stone-300">
                    <p className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      {m.venue?.name} — {m.venue?.address}
                    </p>
                    <p className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      {prettyDate(m.date)} • {formatTime12(m.startTime)} – {formatTime12(m.endTime || m.startTime)}
                      <span className="ml-auto font-black text-emerald-700 dark:text-emerald-300">
                        {formatNPR(m.pricePerPlayer)} each
                      </span>
                    </p>
                  </div>
                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-orange-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex -space-x-2">
                        {(m.players ?? []).slice(0, 6).map((p) => (
                          <span key={p.id} title={p.name}>
                            <Avatar
                              user={{ name: p.name, avatarColor: p.avatarColor, avatarUrl: (p as { avatarUrl?: string }).avatarUrl }}
                              className="h-8 w-8 text-[10px]"
                              ring="border-2 border-white shadow dark:border-stone-900"
                            />
                          </span>
                        ))}
                        {m.joinedCount > 6 && (
                          <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-black text-stone-600 dark:border-stone-900 dark:bg-white/10 dark:text-stone-300">
                            +{m.joinedCount - 6}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-stone-500 dark:text-stone-400">
                        {m.joinedCount}/{m.maxPlayers} in • {m.spotsLeft} open 🙋
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleJoin(m)}
                    disabled={joining === m.id || full}
                    className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black transition ${
                      already
                        ? "border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                        : full
                          ? "cursor-not-allowed bg-stone-100 text-stone-400 dark:bg-white/5 dark:text-stone-500"
                          : "bg-emerald-600 text-white shadow-md hover:bg-emerald-700"
                    }`}
                  >
                    {joining === m.id ? (
                      "Saving your spot…"
                    ) : already ? (
                      <>Can&apos;t make it — leave game</>
                    ) : full ? (
                      "This one's full"
                    ) : (
                      <>
                        <Check className="h-4 w-4" strokeWidth={3} /> Count me in • {formatNPR(m.pricePerPlayer)}
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-stone-900/50 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-stone-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-stone-900">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-stone-900 dark:text-stone-100">Start a friendly game ⚽</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">Your crew + open spots — we&apos;ll help fill the rest.</p>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-white/10 dark:text-stone-300 dark:hover:bg-white/15"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Give your game a fun name</span>
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setFieldErrors((p) => ({ ...p, title: "" }));
                  }}
                  placeholder="e.g. Saturday Laughs & Goals ⚡"
                  maxLength={60}
                  className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-stone-100 dark:placeholder:text-stone-500 ${
                    fieldErrors.title ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                  }`}
                />
                {fieldErrors.title && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.title}</span>}
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Where?</span>
                <select
                  value={venueId}
                  onChange={(e) => setVenueId(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-stone-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-stone-900 dark:[&>option]:text-stone-100"
                >
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Day</span>
                  <input
                    type="date"
                    value={date}
                    min={todayISO(0)}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setFieldErrors((p) => ({ ...p, date: "" }));
                    }}
                    className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:outline-none dark:bg-white/5 dark:text-stone-100 ${
                      fieldErrors.date ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                    }`}
                  />
                  {fieldErrors.date && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.date}</span>}
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Time</span>
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      setFieldErrors((p) => ({ ...p, start: "" }));
                    }}
                    className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:outline-none dark:bg-white/5 dark:text-stone-100 ${
                      fieldErrors.start ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                    }`}
                  />
                  {fieldErrors.start && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.start}</span>}
                </label>
              </div>

              {userTeams.length > 0 && (
                <div>
                  <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Bringing a team? 🛡️
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => pickTeam("")}
                      className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
                        selectedTeam === ""
                          ? "bg-stone-800 text-white dark:bg-white dark:text-stone-900"
                          : "border border-stone-200 bg-white text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300"
                      }`}
                    >
                      Just friends
                    </button>
                    {userTeams.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => pickTeam(String(t.id))}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black transition ${
                          selectedTeam === String(t.id)
                            ? "bg-orange-500 text-white"
                            : "border border-stone-200 bg-white text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300"
                        }`}
                      >
                        <span className="grid h-4 w-4 place-items-center rounded-full text-white" style={{ background: t.logoColor }}>
                          <Shield className="h-2.5 w-2.5" />
                        </span>
                        {t.name} ({t.memberCount})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-stone-200 p-3 dark:border-white/10">
                  <span className="block text-xs font-black text-stone-700 dark:text-stone-200">👥 Our crew</span>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      onClick={() => { setOurCrew((v) => Math.max(1, v - 1)); setSelectedTeam(""); }}
                      className="grid h-8 w-8 place-items-center rounded-full border border-stone-200 dark:border-white/10"
                      aria-label="Fewer crew"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="text-2xl font-black">{ourCrew}</span>
                    <button
                      onClick={() => { setOurCrew((v) => Math.min(21, v + 1)); setSelectedTeam(""); }}
                      className="grid h-8 w-8 place-items-center rounded-full bg-emerald-600 text-white"
                      aria-label="More crew"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="rounded-2xl border border-orange-300 bg-orange-50 p-3 dark:border-orange-500/40 dark:bg-orange-500/10">
                  <span className="block text-xs font-black text-orange-700 dark:text-orange-300">🙋 Open spots</span>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      onClick={() => setOpenSpots((v) => Math.max(1, v - 1))}
                      className="grid h-8 w-8 place-items-center rounded-full border border-orange-300 text-orange-600 dark:border-orange-500/40 dark:text-orange-300"
                      aria-label="Fewer open spots"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="text-2xl font-black text-orange-600 dark:text-orange-300">{openSpots}</span>
                    <button
                      onClick={() => setOpenSpots((v) => Math.min(21, v + 1))}
                      className="grid h-8 w-8 place-items-center rounded-full bg-orange-500 text-white"
                      aria-label="More open spots"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-center text-xs font-bold text-stone-500 dark:text-stone-400">
                {totalPlayers} total • {totalPlayers >= 4 && totalPlayers <= 22 ? "perfect! ✓" : "needs 4–22 ⚠️"}
              </p>

              <div>
                <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Who&apos;s welcome? 💛
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setWelcomeMode("any")}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      welcomeMode === "any"
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                        : "border-stone-200 dark:border-white/10"
                    }`}
                  >
                    <span className="block text-sm font-black">🌍 Anyone!</span>
                    <span className="text-[11px] text-stone-500">All levels, max fun</span>
                  </button>
                  <button
                    onClick={() => setWelcomeMode("specific")}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      welcomeMode === "specific"
                        ? "border-orange-400 bg-orange-50 dark:border-orange-500/50 dark:bg-orange-500/10"
                        : "border-stone-200 dark:border-white/10"
                    }`}
                  >
                    <span className="block text-sm font-black">🎯 Specific</span>
                    <span className="text-[11px] text-stone-500">Pick levels below</span>
                  </button>
                </div>
                {welcomeMode === "specific" && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {LEVEL_OPTIONS.map((l) => {
                      const on = welcomeLevels.includes(l.name);
                      return (
                        <button
                          key={l.name}
                          onClick={() => toggleLevel(l.name)}
                          className={`rounded-xl border px-2 py-2 text-center transition ${
                            on
                              ? "border-orange-500 bg-orange-500 text-white"
                              : "border-stone-200 dark:border-white/10"
                          }`}
                        >
                          <span className="block text-base">{l.emoji}</span>
                          <span className="block text-[11px] font-black">{l.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3.5 dark:border-violet-500/25 dark:bg-violet-500/5">
                <span className="mb-1 block text-xs font-black uppercase tracking-wider text-violet-600 dark:text-violet-300">
                  ✨ Custom charge per joiner
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-stone-400">Rs.</span>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    step={10}
                    value={price}
                    onChange={(e) => {
                      setPrice(Number(e.target.value));
                      setFieldErrors((p) => ({ ...p, price: "" }));
                    }}
                    className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-lg font-black focus:outline-none dark:bg-stone-950 ${
                      fieldErrors.price ? "border-red-400" : "border-violet-300 focus:border-violet-500 dark:border-violet-500/40"
                    }`}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={500}
                  step={10}
                  value={Math.min(500, price)}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className="mt-2 w-full accent-violet-600"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[0, 100, 150, 200, 300].map((v) => (
                    <button
                      key={v}
                      onClick={() => setPrice(v)}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${
                        price === v
                          ? "bg-violet-600 text-white"
                          : "bg-white text-stone-600 shadow-sm dark:bg-white/10 dark:text-stone-300"
                      }`}
                    >
                      {v === 0 ? "🎉 Free" : `Rs. ${v}`}
                    </button>
                  ))}
                </div>
                {fieldErrors.price ? (
                  <p className="mt-1.5 text-[11px] font-bold text-red-500">{fieldErrors.price}</p>
                ) : (
                  <p className="mt-1.5 text-[11px] text-stone-500">
                    {price === 0
                      ? "🎉 Generous! Joiners play free — your crew covers the court."
                      : `🙋 ${openSpots} joiners × ${formatNPR(price)} = ${formatNPR(price * openSpots)} toward the court.`}
                  </p>
                )}
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">A warm note for joiners</span>
                <textarea
                  value={desc}
                  onChange={(e) => {
                    setDesc(e.target.value);
                    setFieldErrors((p) => ({ ...p, desc: "" }));
                  }}
                  rows={2}
                  maxLength={500}
                  placeholder="Beginners welcome, we laugh a lot, bibs ready…"
                  className={`w-full resize-none rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-stone-100 dark:placeholder:text-stone-500 ${
                    fieldErrors.desc ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                  }`}
                />
                {fieldErrors.desc && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.desc}</span>}
              </label>
              {formError && (
                <p className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                  {formError}
                </p>
              )}
              <button
                onClick={createMatch}
                disabled={creating || !title || !venueId}
                className="w-full rounded-2xl bg-emerald-600 py-3.5 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-40"
              >
                {creating ? "Inviting everyone…" : "Share my game 🎉"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
