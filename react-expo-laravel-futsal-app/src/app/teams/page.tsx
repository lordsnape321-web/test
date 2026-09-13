"use client";

import { useEffect, useState } from "react";
import { Plus, Trophy, Shield, X, Crown, MapPin, Users } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { Avatar } from "@/components/Avatar";
import { initials } from "@/lib/futsal";
import { validateTitle, validateMessage, firstError } from "@/lib/validation";

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
  lookingForPlayers: boolean;
  maxPlayers: number;
  memberCount: number;
  captainName: string;
  players: Array<{ id: number; name: string; avatarColor: string; avatarUrl?: string; position: string }>;
};

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#4d7c0f"];

export default function TeamsPage() {
  const { user } = useUser();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [motto, setMotto] = useState("");
  const [level, setLevel] = useState("Intermediate");
  const [color, setColor] = useState(COLORS[0]);
  const [home, setHome] = useState("");
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = async () => {
    const res = await fetch("/api/teams");
    const data = await res.json();
    setTeams(data.teams ?? []);
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
  }, []);

  async function toggleMembership(t: Team) {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    const member = t.players.some((p) => p.id === user.id);
    setActing(t.id);
    try {
      if (member) {
        await fetch(`/api/teams/${t.id}/join?userId=${user.id}`, { method: "DELETE" });
      } else {
        await fetch(`/api/teams/${t.id}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
      }
      await load();
    } finally {
      setActing(null);
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
    if (home.trim() && home.trim().length > 100) errs.home = "Home ground is too long (max 100 characters) 📍";
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
          captainId: user.id,
          level,
          logoColor: color,
          homeGround: home.trim(),
          maxPlayers: 12,
          lookingForPlayers: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create team");
      setShowCreate(false);
      setName("");
      setMotto("");
      setHome("");
      setFormError("");
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
              {teams.length} welcoming squads • every skill level has a home here
            </p>
          </div>
          <button
            onClick={() => (user ? setShowCreate(true) : (window.location.href = "/login"))}
            className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-md transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" strokeWidth={3} /> Start a team
          </button>
        </div>

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

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {teams.map((t) => {
                const member = t.players.some((p) => p.id === user?.id);
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
                        <p className="mt-1 flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
                          <Crown className="h-3 w-3 text-amber-500" /> {t.captainName} • {t.level}
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

                    <button
                      onClick={() => toggleMembership(t)}
                      disabled={acting === t.id}
                      className={`mt-4 w-full rounded-2xl py-3 text-sm font-black transition ${
                        member
                          ? "border border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-white/10 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10"
                          : "bg-emerald-600 text-white shadow-md hover:bg-emerald-700"
                      }`}
                    >
                      {acting === t.id ? "One sec…" : member ? "Take a break from team" : "Join this family 🤗"}
                    </button>
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
                  <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Home turf</span>
                  <input
                    value={home}
                    onChange={(e) => {
                      setHome(e.target.value);
                      setFieldErrors((p) => ({ ...p, home: "" }));
                    }}
                    placeholder="Favourite court"
                    maxLength={100}
                    className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-stone-100 dark:placeholder:text-stone-500 ${
                      fieldErrors.home ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                    }`}
                  />
                  {fieldErrors.home && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.home}</span>}
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
    </main>
  );
}
