"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Crown,
  Dice5,
  MapPin,
  Plus,
  Search,
  Shield,
  UserPlus,
  UserX,
  Users,
  X,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { normalizeTeamCode, suggestTeamCode } from "@/lib/teams";
import {
  firstError,
  validateMessage,
  validateTeamCode,
  validateTitle,
} from "@/lib/validation";

/** Everything the panel edits — the full team row as `/api/teams` returns it. */
export type ManagedTeam = {
  id: number;
  name: string;
  motto: string;
  teamCode: string;
  level: string;
  logoColor: string;
  maxPlayers: number;
  homeGround: string;
  homeVenueId: number | null;
  lookingForPlayers: boolean;
  captainId: number;
};

type RosterMember = {
  userId: number;
  name: string;
  email: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  role: string;
  isCaptain: boolean;
};

type JoinRequest = {
  id: number;
  userId: number;
  name: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  message: string;
  status: string;
};

type VenueOption = { id: number; name: string; city: string };
type Candidate = {
  id: number;
  name: string;
  email: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
};

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#4d7c0f"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];

const inputCls = (bad?: string) =>
  `w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-stone-100 dark:placeholder:text-stone-500 ${
    bad ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
  }`;

/**
 * The captain's panel 👑 — one place to run a squad: decide join requests, add
 * and remove members, hand over the armband, and edit the team's details.
 *
 * Only the captain ever sees this; every action re-checks that server-side, so
 * the UI hiding a button is a courtesy rather than the security.
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
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [venueOptions, setVenueOptions] = useState<VenueOption[]>([]);
  const [people, setPeople] = useState<Candidate[]>([]);
  const [find, setFind] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  // Editable copy of the team details.
  const [name, setName] = useState(team.name);
  const [motto, setMotto] = useState(team.motto);
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
      const [membersRes, requestsRes] = await Promise.all([
        // viewerId unlocks the members' email addresses for the captain only.
        fetch(`/api/teams/${team.id}/members?viewerId=${captainId}`),
        fetch(`/api/teams/${team.id}/requests?captainId=${captainId}`),
      ]);
      const membersData = await membersRes.json().catch(() => ({}));
      const requestsData = await requestsRes.json().catch(() => ({}));
      setRoster(membersData.roster ?? []);
      setRequests(requestsData.requests ?? []);
    } finally {
      setLoading(false);
    }
  }, [team.id, captainId]);

  useEffect(() => {
    (async () => {
      await load();
      try {
        const [vRes, uRes] = await Promise.all([fetch("/api/venues"), fetch("/api/users")]);
        const vData = await vRes.json().catch(() => ({}));
        const uData = await uRes.json().catch(() => ({}));
        setVenueOptions(
          ((vData.venues ?? []) as Array<{ id: number; name: string; city: string }>).map((v) => ({
            id: v.id,
            name: v.name,
            city: v.city,
          }))
        );
        setPeople(uData.users ?? []);
      } catch {
        /* the add-member search just stays empty */
      }
    })();
  }, [load]);

  /** Run a mutation, then refresh both lists and the parent's cards. */
  async function act(key: string, run: () => Promise<{ status: number; data: Record<string, unknown> }>, okMsg: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const { status, data } = await run();
      if (status >= 400) throw new Error(String(data.error ?? "That didn't work 🛡️"));
      setNotice(okMsg);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work 🛡️");
    } finally {
      setBusy(null);
    }
  }

  const decide = (requestId: number, action: "accept" | "decline", who: string) =>
    act(`req-${requestId}`, () =>
      fetch(`/api/teams/${team.id}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captainId, requestId, action }),
      }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
    , action === "accept" ? `${who} is in the squad 🎉` : `${who}'s request declined`);

  const addMember = (userId: number, who: string) =>
    act(`add-${userId}`, () =>
      fetch(`/api/teams/${team.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captainId, userId }),
      }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
    , `${who} added to ${team.name} 🛡️`);

  const removeMember = (userId: number, who: string) =>
    act(`rm-${userId}`, () =>
      fetch(`/api/teams/${team.id}/members?captainId=${captainId}&userId=${userId}`, {
        method: "DELETE",
      }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
    , `${who} removed from the squad`);

  const handOver = (userId: number, who: string) =>
    act("transfer", () =>
      fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captainId, newCaptainId: userId }),
      }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
    , `${who} captains ${team.name} now 👑`);

  function saveDetails() {
    const errs: Record<string, string> = {};
    const nErr = validateTitle(name, { min: 3, max: 50, label: "Team name" });
    if (nErr) errs.name = nErr;
    if (motto.trim()) {
      const mErr = validateMessage(motto.trim(), { min: 3, max: 120, label: "Motto", required: false });
      if (mErr) errs.motto = mErr;
    }
    const cErr = validateTeamCode(code);
    if (cErr) errs.code = cErr;
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError(firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏");
      return;
    }
    void act("save", () =>
      fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captainId,
          name: name.trim(),
          motto: motto.trim(),
          level,
          logoColor: color,
          maxPlayers: Number(maxPlayers),
          homeVenueId: Number(homeVenueId) || 0,
          teamCode: normalizeTeamCode(code),
          lookingForPlayers: looking,
        }),
      }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
    , "Team details saved ✅");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(normalizeTeamCode(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const memberIds = useMemo(() => new Set(roster.map((m) => m.userId)), [roster]);
  const candidates = useMemo(() => {
    const q = find.trim().toLowerCase();
    return people
      .filter((p) => !memberIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 6);
  }, [people, memberIds, find]);
  const transferTargets = roster.filter((m) => !m.isCaptain);
  const squadFull = roster.length >= maxPlayers;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-start overflow-y-auto bg-stone-900/50 p-4 backdrop-blur-sm">
      <div className="my-auto w-full max-w-2xl rounded-[2rem] border border-stone-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-stone-900">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-black text-white shadow-lg"
              style={{ background: `linear-gradient(135deg, ${color}, #44403c)` }}
            >
              <Shield className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-black text-stone-900 dark:text-stone-100">
                Manage {team.name}
              </h3>
              <p className="flex items-center gap-1.5 text-xs font-bold text-stone-500 dark:text-stone-400">
                <Crown className="h-3 w-3 text-amber-500" /> You&apos;re the captain •{" "}
                <span className="font-mono">{normalizeTeamCode(code) || "no code"}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-600 dark:bg-white/10 dark:text-stone-300"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            {notice}
          </p>
        )}

        {loading ? (
          <div className="mt-5 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-stone-100 dark:bg-white/5" />
            ))}
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {/* ------------------------------------------ join requests */}
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/25 dark:bg-amber-500/5">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                <Users className="h-3.5 w-3.5" /> Join requests
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] text-white">
                  {requests.length}
                </span>
              </h4>
              {requests.length === 0 ? (
                <p className="mt-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
                  Nobody waiting right now 🎉 Share your code{" "}
                  <span className="font-mono font-black">{normalizeTeamCode(code)}</span> so people can find you.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {requests.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-2.5 rounded-xl border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-stone-950"
                    >
                      <Avatar
                        user={{ name: r.name, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl }}
                        className="h-9 w-9 text-[11px]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-stone-900 dark:text-stone-100">{r.name}</p>
                        <p className="truncate text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                          {r.level} • {r.position}
                        </p>
                        {r.message && (
                          <p className="mt-1 line-clamp-2 text-[11px] italic text-stone-500 dark:text-stone-400">
                            &ldquo;{r.message}&rdquo;
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => decide(r.id, "accept", r.name)}
                          disabled={busy === `req-${r.id}` || squadFull}
                          title={squadFull ? `Squad is full (${roster.length}/${maxPlayers})` : "Accept"}
                          className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black text-white transition hover:bg-emerald-700 disabled:opacity-40"
                        >
                          <Check className="h-3.5 w-3.5" /> Accept
                        </button>
                        <button
                          onClick={() => decide(r.id, "decline", r.name)}
                          disabled={busy === `req-${r.id}`}
                          className="flex items-center gap-1 rounded-xl border border-stone-200 px-3 py-2 text-[11px] font-black text-stone-600 transition hover:bg-stone-100 disabled:opacity-40 dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/10"
                        >
                          <X className="h-3.5 w-3.5" /> Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {squadFull && (
                <p className="mt-2 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                  Squad is full ({roster.length}/{maxPlayers}) — raise the team size below before accepting 👥
                </p>
              )}
            </section>

            {/* ------------------------------------------ roster */}
            <section className="rounded-2xl border border-stone-200 p-4 dark:border-white/10">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                <Shield className="h-3.5 w-3.5" /> Squad • {roster.length}/{maxPlayers}
              </h4>
              <ul className="mt-3 space-y-1.5">
                {roster.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center gap-2.5 rounded-xl bg-stone-50 px-3 py-2 dark:bg-white/5"
                  >
                    <Avatar
                      user={{ name: m.name, avatarColor: m.avatarColor, avatarUrl: m.avatarUrl }}
                      className="h-8 w-8 text-[10px]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-bold text-stone-900 dark:text-stone-100">
                        {m.name}
                        {m.isCaptain && (
                          <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            <Crown className="h-2.5 w-2.5" /> Captain
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">
                        {m.level} • {m.position}
                        {m.email ? ` • ${m.email}` : ""}
                      </p>
                    </div>
                    {m.isCaptain ? (
                      <span className="text-[10px] font-black text-stone-400 dark:text-stone-500">
                        {m.userId === captainId ? "that's you" : "captain"}
                      </span>
                    ) : (
                      <button
                        onClick={() => removeMember(m.userId, m.name)}
                        disabled={busy === `rm-${m.userId}`}
                        className="flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-[10px] font-black text-red-600 transition hover:bg-red-50 disabled:opacity-40 dark:border-white/10 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        <UserX className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {/* ------------------------------------------ add a member */}
            <section className="rounded-2xl border border-stone-200 p-4 dark:border-white/10">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-stone-500 dark:text-stone-400">
                <UserPlus className="h-3.5 w-3.5" /> Add someone straight in
              </h4>
              <div className="relative mt-2.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder="Search players by name or email…"
                  className={inputCls()}
                  style={{ paddingLeft: "2.25rem" }}
                />
              </div>
              {candidates.length === 0 ? (
                <p className="mt-2 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                  {find.trim()
                    ? "No player outside your squad matches that 🔍"
                    : "Every registered player is already in your squad 🎉"}
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {candidates.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2.5 rounded-xl bg-stone-50 px-3 py-2 dark:bg-white/5"
                    >
                      <Avatar
                        user={{ name: p.name, avatarColor: p.avatarColor, avatarUrl: p.avatarUrl }}
                        className="h-8 w-8 text-[10px]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">{p.name}</p>
                        <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">
                          {p.level} • {p.position} • {p.email}
                        </p>
                      </div>
                      <button
                        onClick={() => addMember(p.id, p.name)}
                        disabled={busy === `add-${p.id}` || squadFull}
                        className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white transition hover:bg-emerald-700 disabled:opacity-40"
                      >
                        <Plus className="h-3 w-3" /> Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ------------------------------------------ hand over */}
            <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-500/25 dark:bg-amber-500/5">
              <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                <Crown className="h-3.5 w-3.5" /> Hand over the armband
              </h4>
              <p className="mt-1 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                A team always has exactly one captain. To step away, pass it to a member first —
                then you&apos;ll be able to leave the squad like anyone else.
              </p>
              {transferTargets.length === 0 ? (
                <p className="mt-2 text-[11px] font-bold text-stone-400 dark:text-stone-500">
                  No other members yet — add someone before you can hand over 👥
                </p>
              ) : (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <select
                    value={newCaptainId}
                    onChange={(e) => setNewCaptainId(e.target.value)}
                    className="min-w-[12rem] flex-1 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-amber-500 focus:outline-none dark:border-white/10 dark:bg-stone-950 dark:text-stone-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-stone-900 dark:[&>option]:text-stone-100"
                  >
                    <option value="">Choose the next captain…</option>
                    {transferTargets.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} — {m.level} • {m.position}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const target = transferTargets.find((m) => String(m.userId) === newCaptainId);
                      if (target) void handOver(target.userId, target.name);
                    }}
                    disabled={!newCaptainId || busy === "transfer"}
                    className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-white transition hover:bg-amber-600 disabled:opacity-40"
                  >
                    <Crown className="h-4 w-4" /> Transfer
                  </button>
                </div>
              )}
            </section>

            {/* ------------------------------------------ details */}
            <section className="rounded-2xl border border-stone-200 p-4 dark:border-white/10">
              <h4 className="text-xs font-black uppercase tracking-widest text-stone-500 dark:text-stone-400">
                Team details
              </h4>
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Team name
                  </span>
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setFieldErrors((p) => ({ ...p, name: "" }));
                    }}
                    maxLength={50}
                    className={inputCls(fieldErrors.name)}
                  />
                  {fieldErrors.name && (
                    <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.name}</span>
                  )}
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Unique code — how others find you
                  </span>
                  <div className="flex gap-2">
                    <input
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.toUpperCase());
                        setFieldErrors((p) => ({ ...p, code: "" }));
                      }}
                      maxLength={24}
                      placeholder="CHARGERS-4X7K"
                      className={`${inputCls(fieldErrors.code)} font-mono uppercase`}
                    />
                    <button
                      onClick={() => setCode(suggestTeamCode(name || team.name))}
                      title="Suggest a code"
                      className="grid w-11 shrink-0 place-items-center rounded-xl border border-stone-200 text-stone-500 transition hover:bg-stone-100 dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/10"
                    >
                      <Dice5 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={copyCode}
                      title="Copy code"
                      className="grid w-11 shrink-0 place-items-center rounded-xl border border-stone-200 text-stone-500 transition hover:bg-stone-100 dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/10"
                    >
                      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  {fieldErrors.code ? (
                    <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.code}</span>
                  ) : (
                    <span className="mt-1 block text-[11px] text-stone-400">
                      Letters, numbers and dashes • read it out loud and teammates can search it 🔍
                    </span>
                  )}
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Motto
                  </span>
                  <input
                    value={motto}
                    onChange={(e) => {
                      setMotto(e.target.value);
                      setFieldErrors((p) => ({ ...p, motto: "" }));
                    }}
                    maxLength={120}
                    className={inputCls(fieldErrors.motto)}
                  />
                  {fieldErrors.motto && (
                    <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.motto}</span>
                  )}
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                      Level
                    </span>
                    <select
                      value={level}
                      onChange={(e) => setLevel(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-stone-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-stone-900 dark:[&>option]:text-stone-100"
                    >
                      {LEVELS.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                      Team size • {roster.length} in squad
                    </span>
                    <input
                      type="number"
                      min={4}
                      max={30}
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(Number(e.target.value))}
                      className={inputCls()}
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    <MapPin className="h-3 w-3" /> Home turf — venues on this platform
                  </span>
                  <select
                    value={homeVenueId}
                    onChange={(e) => setHomeVenueId(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-stone-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-stone-900 dark:[&>option]:text-stone-100"
                  >
                    <option value="0">No home turf</option>
                    {venueOptions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} — {v.city}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-stone-400">
                    {venueOptions.length} venues to pick from — no typing, so it always matches a real court 📍
                  </span>
                </label>

                <div>
                  <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Colours
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`h-9 w-9 rounded-full transition ${
                          color === c
                            ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-stone-900"
                            : ""
                        }`}
                        style={{ background: c }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-stone-50 px-3.5 py-3 dark:bg-white/5">
                  <input
                    type="checkbox"
                    checked={looking}
                    onChange={(e) => setLooking(e.target.checked)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span className="text-xs font-bold text-stone-700 dark:text-stone-200">
                    Welcoming new friends — show this squad to people searching for a team
                  </span>
                </label>
              </div>

              <button
                onClick={saveDetails}
                disabled={busy === "save"}
                className="mt-4 w-full rounded-2xl bg-emerald-600 py-3.5 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-40"
              >
                {busy === "save" ? "Saving…" : "Save changes ✅"}
              </button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
