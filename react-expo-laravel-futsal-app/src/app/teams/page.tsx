"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Trophy,
  Shield,
  X,
  Crown,
  MapPin,
  Users,
  Search,
  Dice5,
  Settings,
  Hourglass,
  Hash,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { Avatar } from "@/components/Avatar";
import { TeamManager } from "@/components/TeamManager";
import { initials } from "@/lib/futsal";
import { normalizeTeamCode, suggestTeamCode } from "@/lib/teams";
import {
  firstError,
  validateMessage,
  validateTeamCode,
  validateTitle,
} from "@/lib/validation";

type Team = {
  id: number;
  name: string;
  motto: string;
  level: string;
  logoColor: string;
  wins: number;
  losses: number;
  draws: number;
  homeGround: string;
  /** Venue on this platform the squad calls home, if it picked one. */
  homeVenueId: number | null;
  /** Unique searchable handle. */
  teamCode: string;
  captainId: number;
  lookingForPlayers: boolean;
  maxPlayers: number;
  memberCount: number;
  captainName: string;
  /** Waiting join requests — only non-zero for the captain. */
  pendingRequests: number;
  /** This viewer's relationship to the squad, when logged in. */
  viewer: {
    isMember: boolean;
    isCaptain: boolean;
    requestStatus: string | null;
    requestId: number | null;
  } | null;
  players: Array<{ id: number; name: string; avatarColor: string; avatarUrl?: string; position: string }>;
};

type VenueOption = { id: number; name: string; city: string };

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#4d7c0f"];

export default function TeamsPage() {
  const { user } = useUser();
  const [teams, setTeams] = useState<Team[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [motto, setMotto] = useState("");
  const [level, setLevel] = useState("Intermediate");
  const [color, setColor] = useState(COLORS[0]);
  const [homeVenueId, setHomeVenueId] = useState("0");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [managing, setManaging] = useState<Team | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeBad, setNoticeBad] = useState(false);
  // `find` is what's typed, `q` is what has been submitted — searching on submit
  // keeps a keystroke from firing a request (and a re-seed) every time.
  const [find, setFind] = useState("");
  const [q, setQ] = useState("");

  /**
   * `viewerId` tells the API whose buttons to draw: it comes back with whether
   * this player is a member, whether they captain the squad, and whether they
   * have a request waiting on the captain.
   */
  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (user) params.set("viewerId", String(user.id));
    const res = await fetch(`/api/teams?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    // Returned as well as stored so callers (the captain panel) can react to
    // what the server now says — e.g. "you handed the armband over".
    const fresh = (data.teams ?? []) as Team[];
    setTeams(fresh);
    return fresh;
  }, [q, user]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Seed on first visit so a fresh database has squads to show. The call is
        // idempotent ("Already seeded"), so re-running it after a search is cheap.
        await fetch("/api/seed", { method: "POST" });
        await load();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  // Venues for the home-turf dropdowns — only courts that exist on the platform.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/venues");
        const data = await res.json().catch(() => ({}));
        setVenues(
          ((data.venues ?? []) as Array<{ id: number; name: string; city: string }>).map(
            (v) => ({ id: v.id, name: v.name, city: v.city })
          )
        );
      } catch {
        setVenues([]);
      }
    })();
  }, []);

  /**
   * Join / withdraw. Asking no longer adds you to the squad — it files a request
   * the captain accepts or declines, so the button reports what is really true.
   */
  async function toggleMembership(t: Team) {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setActing(t.id);
    setNotice("");
    setNoticeBad(false);
    try {
      const pending = t.viewer?.requestStatus === "pending";
      const res = await fetch(
        `/api/teams/${t.id}/join${pending || t.viewer?.isMember ? `?userId=${user.id}` : ""}`,
        pending || t.viewer?.isMember
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: user.id }),
            }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error || "That didn't work 🛡️"));
      setNotice(
        data.cancelled
          ? `Request to join ${t.name} withdrawn`
          : data.left
            ? `You've stepped away from ${t.name}`
            : data.alreadyMember
              ? `You're already in ${t.name} 🛡️`
              : `Request sent — ${t.name}'s captain will review it 👑`
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work 🛡️");
      setNoticeBad(true);
    } finally {
      setActing(null);
      await load();
    }
  }

  async function createTeam() {
    if (!user) return;
    const errs: Record<string, string> = {};
    const nErr = validateTitle(name, { min: 3, max: 50, label: "Team name" });
    if (nErr) errs.name = nErr;
    if (motto.trim()) {
      const mErr = validateMessage(motto.trim(), { min: 3, max: 120, label: "Motto", required: false });
      if (mErr) errs.motto = mErr;
    }
    const cErr = validateTeamCode(code);
    if (cErr) errs.code = cErr;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setFormError(firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏");
      return;
    }
    setFieldErrors({});
    setFormError("");
    setCreating(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          motto: motto.trim(),
          // Unique searchable handle — normalised here and again server-side.
          teamCode: normalizeTeamCode(code),
          captainId: user.id,
          level,
          logoColor: color,
          // A venue that exists on the platform, never free text.
          homeVenueId: Number(homeVenueId) || 0,
          maxPlayers: 12,
          lookingForPlayers: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create team");
      setShowCreate(false);
      setName("");
      setMotto("");
      setCode("");
      setHomeVenueId("0");
      setFormError("");
      setNotice(
        `${data.team?.name ?? "Your team"} is live 🎉 Share the code ${
          data.team?.teamCode ?? ""
        } so other players can find you`
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't create team 🙏");
    } finally {
      setCreating(false);
      await load();
    }
  }

  const sorted = [...teams].sort((a, b) => b.wins * 3 + b.draws - (a.wins * 3 + a.draws));

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
              <Users className="h-3.5 w-3.5" /> Find your people
            </p>
            <h1 className="mt-1 text-3xl font-black text-stone-900 dark:text-stone-100">Teams & friendly leagues</h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {q
                ? `${teams.length} squad${teams.length === 1 ? "" : "s"} matching "${q}"`
                : `${teams.length} welcoming squads • every skill level has a home here`}
            </p>
          </div>
          <button
            onClick={() => (user ? setShowCreate(true) : (window.location.href = "/login"))}
            className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-md transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" strokeWidth={3} /> Start a team
          </button>
        </div>

        {/* Find a squad by the unique code a teammate read you, or by name. */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setQ(find);
                }
              }}
              placeholder="Search a team code — e.g. CHARGERS-4X7K"
              aria-label="Search teams by code or name"
              className="w-full rounded-2xl border border-[#F0E3CC] bg-white py-3 pl-10 pr-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
          </div>
          <button
            onClick={() => setQ(find)}
            className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-black text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
          >
            Search
          </button>
          {q && (
            <button
              onClick={() => {
                setQ("");
                setFind("");
              }}
              className="flex items-center gap-1.5 rounded-2xl border border-stone-200 px-4 py-3 text-sm font-black text-stone-600 transition hover:bg-stone-100 dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" /> Clear
            </button>
          )}
        </div>

        {notice && (
          <p
            className={`mt-3 rounded-2xl px-4 py-3 text-xs font-bold ${
              noticeBad
                ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
            }`}
          >
            {notice}
          </p>
        )}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-56 animate-pulse rounded-3xl bg-white dark:bg-stone-900" />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-6 overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white shadow-sm dark:border-white/10 dark:bg-stone-900">
              <div className="border-b border-stone-100 bg-emerald-700 px-5 py-3 dark:border-white/5">
                <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-50">
                  <Trophy className="h-3.5 w-3.5" /> Family league table — Season 4
                </p>
              </div>
              <div className="divide-y divide-stone-100 dark:divide-white/5">
                {sorted.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className={`w-6 text-sm font-black ${i < 3 ? "text-orange-500 dark:text-orange-400" : "text-stone-300 dark:text-stone-600"}`}>
                      {i + 1}
                    </span>
                    <span
                      className="grid h-8 w-8 place-items-center rounded-xl text-xs font-black text-white shadow"
                      style={{ background: t.logoColor }}
                    >
                      {initials(t.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-stone-900 dark:text-stone-100">
                      {t.name}
                    </span>
                    <span className="hidden text-xs text-stone-400 sm:block dark:text-stone-500">
                      {t.wins}W • {t.draws}D • {t.losses}L
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {t.wins * 3 + t.draws} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {teams.length === 0 && (
              <div className="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-10 text-center dark:border-white/10 dark:bg-stone-900">
                <p className="text-sm font-black text-stone-700 dark:text-stone-200">
                  {q ? `No squad matches "${q}" yet` : "No squads on the platform yet"}
                </p>
                <p className="mt-1 text-xs font-semibold text-stone-400 dark:text-stone-500">
                  {q
                    ? "Check the code for typos — no spaces, and dashes count."
                    : "Be the first to start one 🎉"}
                </p>
              </div>
            )}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {teams.map((t) => {
                // The API tells us this viewer's relationship to the squad; fall
                // back to the roster for a logged-out visitor.
                const isCaptain = t.viewer?.isCaptain ?? (user ? t.captainId === user.id : false);
                const member = t.viewer?.isMember ?? t.players.some((p) => p.id === user?.id);
                const pending = t.viewer?.requestStatus === "pending";
                const winRate =
                  t.wins + t.losses + t.draws > 0
                    ? Math.round((t.wins / (t.wins + t.losses + t.draws)) * 100)
                    : 0;
                return (
                  <div
                    key={t.id}
                    className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-[0_10px_30px_rgba(180,120,60,0.08)] transition hover:border-emerald-300 dark:border-white/10 dark:bg-stone-900 dark:hover:border-emerald-500/50"
                  >
                    <div className="flex items-start gap-3.5">
                      <span
                        className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-black text-white shadow-lg"
                        style={{ background: `linear-gradient(135deg, ${t.logoColor}, #44403c)` }}
                      >
                        {initials(t.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-base font-extrabold text-stone-900 dark:text-stone-100">{t.name}</h3>
                          {t.lookingForPlayers && (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                              Welcoming new friends
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs italic text-stone-400 dark:text-stone-500">
                          &quot;{t.motto || "Come play with us!"}&quot;
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                          <span className="flex items-center gap-1">
                            <Crown className="h-3 w-3 text-amber-500" /> {t.captainName} • {t.level}
                          </span>
                          {t.teamCode && (
                            <span
                              title="Search this code to find the squad again"
                              className="flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] font-black text-stone-600 dark:bg-white/10 dark:text-stone-300"
                            >
                              <Hash className="h-2.5 w-2.5" /> {t.teamCode}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                      {[
                        { l: "Wins", v: t.wins },
                        { l: "Draws", v: t.draws },
                        { l: "Losses", v: t.losses },
                        { l: "Win %", v: `${winRate}%` },
                      ].map((s) => (
                        <div key={s.l} className="rounded-xl bg-[#FFF6E9] py-2 dark:bg-white/5">
                          <p className="text-base font-black text-stone-900 dark:text-stone-100">{s.v}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                            {s.l}
                          </p>
                        </div>
                      ))}
                    </div>

                    {t.homeGround && (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                        <MapPin className="h-3.5 w-3.5" /> Home turf: {t.homeGround}
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex -space-x-2">
                        {t.players.slice(0, 6).map((p) => (
                          <span key={p.id} title={`${p.name} (${p.position})`}>
                            <Avatar
                              user={{ name: p.name, avatarColor: p.avatarColor, avatarUrl: p.avatarUrl }}
                              className="h-8 w-8 text-[10px]"
                              ring="border-2 border-white shadow dark:border-stone-900"
                            />
                          </span>
                        ))}
                        {t.memberCount > 6 && (
                          <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-black text-stone-600 dark:border-stone-900 dark:bg-white/10 dark:text-stone-300">
                            +{t.memberCount - 6}
                          </span>
                        )}
                      </div>
                      <span className="flex items-center gap-1 text-xs font-bold text-stone-500 dark:text-stone-400">
                        <Shield className="h-3.5 w-3.5" /> {t.memberCount}/{t.maxPlayers} mates
                      </span>
                    </div>

                    {isCaptain ? (
                      <>
                        <button
                          onClick={() => setManaging(t)}
                          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 py-3 text-sm font-black text-white shadow-md transition hover:bg-amber-600"
                        >
                          <Settings className="h-4 w-4" /> Manage your squad
                          {t.pendingRequests > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-[10px]">
                              <Hourglass className="h-2.5 w-2.5" /> {t.pendingRequests} waiting
                            </span>
                          )}
                        </button>
                        <p className="mt-1.5 text-center text-[10px] font-bold leading-relaxed text-stone-400 dark:text-stone-500">
                          👑 You captain this squad — a team always has exactly one captain, so hand
                          over the armband in Manage before stepping away
                        </p>
                      </>
                    ) : (
                      <button
                        onClick={() => toggleMembership(t)}
                        disabled={acting === t.id}
                        className={`mt-4 w-full rounded-2xl py-3 text-sm font-black transition ${
                          pending
                            ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                            : member
                              ? "border border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-white/10 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10"
                              : "bg-emerald-600 text-white shadow-md hover:bg-emerald-700"
                        }`}
                      >
                        {acting === t.id
                          ? "One sec…"
                          : pending
                            ? "Request pending ⏳ — tap to withdraw"
                            : member
                              ? "Take a break from team"
                              : "Request to join 🛡️"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-stone-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[2rem] border border-stone-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-stone-900">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-stone-900 dark:text-stone-100">Start your own crew 🎉</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">Every great team starts with one friend.</p>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-stone-600 dark:bg-white/10 dark:text-stone-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Team name</span>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldErrors((p) => ({ ...p, name: "" }));
                  }}
                  placeholder="e.g. Sunday Smiles FC"
                  maxLength={50}
                  className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-stone-100 dark:placeholder:text-stone-500 ${
                    fieldErrors.name ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                  }`}
                />
                {fieldErrors.name ? (
                  <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.name}</span>
                ) : (
                  <span className="mt-1 block text-[11px] text-stone-400">{name.trim().length}/50 • min 3 ✨</span>
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Team motto</span>
                <input
                  value={motto}
                  onChange={(e) => {
                    setMotto(e.target.value);
                    setFieldErrors((p) => ({ ...p, motto: "" }));
                  }}
                  placeholder="e.g. Play happy, win happy"
                  maxLength={120}
                  className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-stone-100 dark:placeholder:text-stone-500 ${
                    fieldErrors.motto ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                  }`}
                />
                {fieldErrors.motto && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.motto}</span>}
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  <Hash className="h-3 w-3" /> Team code — unique
                </span>
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      setFieldErrors((p) => ({ ...p, code: "", teamCode: "" }));
                    }}
                    placeholder="CHARGERS-4X7K"
                    maxLength={24}
                    aria-label="Team code"
                    className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 font-mono text-sm font-black tracking-wider text-stone-900 placeholder:font-sans placeholder:font-semibold placeholder:tracking-normal placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-stone-100 dark:placeholder:text-stone-500 ${
                      fieldErrors.teamCode || fieldErrors.code
                        ? "border-red-400"
                        : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setCode(suggestTeamCode(name))}
                    title="Generate a code from the team name"
                    aria-label="Generate a team code"
                    className="shrink-0 rounded-xl border border-stone-200 bg-white px-3 text-stone-500 transition hover:bg-stone-100 dark:border-white/10 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10"
                  >
                    <Dice5 className="h-4 w-4" />
                  </button>
                </div>
                {fieldErrors.teamCode || fieldErrors.code ? (
                  <span className="mt-1 block text-[11px] font-bold text-red-500">
                    {fieldErrors.teamCode || fieldErrors.code}
                  </span>
                ) : (
                  <span className="mt-1 block text-[11px] text-stone-400">
                    Optional — leave it blank and we&apos;ll generate one. Letters, numbers and
                    dashes only, 4–24 chars. Teammates search this exact code to find you 🔎
                  </span>
                )}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Level</span>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-stone-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-stone-900 dark:[&>option]:text-stone-100"
                  >
                    {["Beginner", "Intermediate", "Advanced"].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    <MapPin className="h-3 w-3" /> Home turf
                  </span>
                  <select
                    value={homeVenueId}
                    onChange={(e) => setHomeVenueId(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-stone-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-stone-900 dark:[&>option]:text-stone-100"
                  >
                    <option value="0">No home turf yet</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} — {v.city}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-stone-400">
                    {venues.length > 0
                      ? `From the platform's ${venues.length} venues 📍`
                      : "No venues yet — set it later"}
                  </span>
                </label>
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Pick your colours</span>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`h-9 w-9 rounded-full transition ${color === c ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-stone-900" : ""}`}
                      style={{ background: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
              {formError && (
                <p className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                  {formError}
                </p>
              )}
              <button
                onClick={createTeam}
                disabled={creating}
                className="w-full rounded-2xl bg-emerald-600 py-3.5 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-40"
              >
                {creating ? "Gathering the crew…" : "Create my team 🎉"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Captain's control panel 👑 — only ever mounted for the squad's captain. */}
      {managing && user && (
        <TeamManager
          team={{
            id: managing.id,
            name: managing.name,
            motto: managing.motto,
            teamCode: managing.teamCode ?? "",
            level: managing.level,
            logoColor: managing.logoColor,
            maxPlayers: managing.maxPlayers,
            homeGround: managing.homeGround,
            homeVenueId: managing.homeVenueId,
            lookingForPlayers: managing.lookingForPlayers,
            captainId: managing.captainId,
          }}
          captainId={user.id}
          onClose={() => setManaging(null)}
          onChanged={async () => {
            const fresh = await load();
            const stillCaptain = fresh.find((t) => t.id === managing.id)?.viewer?.isCaptain ?? false;
            if (!stillCaptain) {
              setManaging(null);
              setNoticeBad(false);
              setNotice("Armband handed over 👑 you're a regular member of the squad now");
            }
          }}
        />
      )}
    </main>
  );
}
