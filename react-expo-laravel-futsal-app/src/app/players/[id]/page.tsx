"use client";
import { ThemedSelect } from "@/components/ThemedSelect";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Crown,
  Hash,
  MapPin,
  MessageSquare,
  Send,
  Shield,
  ShieldAlert,
  Star,
  Trophy,
  UserPlus,
  X,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { Avatar } from "@/components/Avatar";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import type { PlayerStats } from "@/lib/loyalty";
import { initials } from "@/lib/futsal";
import { timeAgo } from "@/components/NotificationBell";
import { apiFetch } from "@/lib/api";

type Squad = {
  id: number;
  name: string;
  teamCode: string;
  memberCount: number;
  logoColor: string;
  level: string;
  role: string;
  motto: string;
  description: string;
  maxPlayers: number;
  wins: number;
  draws: number;
  losses: number;
  homeGround: string;
  lookingForPlayers: boolean;
};

type QueueRow = {
  kind: "request" | "invite";
  id: number;
  teamId: number;
  teamName: string;
  teamCode: string;
  logoColor: string;
  message: string;
  status: string;
  createdAt: string | null;
  decidedAt: string | null;
};

type CaptainOption = {
  teamId: number;
  name: string;
  teamCode: string;
  logoColor: string;
  level: string;
  memberCount: number;
  maxPlayers: number;
  squadFull: boolean;
  invitesLeftToday: number;
  isMember: boolean;
  hasPendingRequest: boolean;
  hasPendingInvite: boolean;
};

type Dossier = {
  player: {
    id: number;
    name: string;
    avatarColor: string;
    avatarUrl: string;
    role: string;
    level: string;
    position: string;
    defaultCity: string;
    matchesPlayed: number;
    trustScore: number;
    memberSince: string | null;
  };
  invitable: boolean;
  /** The same reliability the player sees on their own profile — one source, no flattery. */
  stats: PlayerStats;
  teams: Squad[];
  reviews: Array<{
    id: number;
    venueId: number;
    venueName: string;
    rating: number;
    message: string;
    createdAt: string | null;
  }>;
  matches: {
    organized: MatchRow[];
    joined: MatchRow[];
  };
  myQueue: QueueRow[];
  captainOptions: CaptainOption[];
  viewer: { id: number; isSelf: boolean; hasSomethingToDecide: boolean; leadsAnyTeam: boolean } | null;
};

type MatchRow = {
  id: number;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  level: string;
  status: string;
  pricePerPlayer: number;
  venueName: string;
};

const card =
  "rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-[0_10px_30px_rgba(180,120,60,0.08)] dark:border-white/10 dark:bg-slate-900";
const label =
  "text-[10px] font-black uppercase tracking-widest text-stone-400 dark:text-slate-500";

/**
 * The full dossier of one player 👤
 *
 * A join request in the captain's panel is one sentence and a name, which is not
 * much to judge a person on. This page is what "view their full details" opens
 * into: profile, reliability, the squads they already play for, the games they
 * turn up to — and, for the captain reading it, the request itself, answerable
 * here rather than by closing the dialog and hunting for the row again.
 */
export default function PlayerDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useUser();
  const [data, setData] = useState<Dossier | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeBad, setNoticeBad] = useState(false);
  const [inviteTeam, setInviteTeam] = useState("");
  const [inviteNote, setInviteNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/players/${id}${user ? `?viewerId=${user.id}` : ""}`
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error ?? "Couldn't load that player 🙏"));
      setData(body as Dossier);
      if (!inviteTeam) {
        const first = (body.captainOptions ?? []).find(
          (t: CaptainOption) =>
            !t.isMember && !t.squadFull && t.invitesLeftToday > 0 && !t.hasPendingRequest && !t.hasPendingInvite
        );
        if (first) setInviteTeam(String(first.teamId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that player 🙏");
    } finally {
      setLoading(false);
    }
    // inviteTeam is read once, on the first load only — see the guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  useEffect(() => {
    // Same shape as /teams: the fetch is kicked off inside an async body and
    // guarded, so a slow response can never land on an unmounted page.
    let alive = true;
    (async () => {
      if (alive) await load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  /** One runner for the three actions a captain can take from here. */
  async function act(key: string, run: () => Promise<Response>, okMsg: string) {
    setBusy(key);
    setNotice("");
    setNoticeBad(false);
    try {
      const res = await run();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error ?? "That didn't work 🛡️"));
      setNotice(okMsg);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work 🛡️");
      setNoticeBad(true);
    } finally {
      setBusy(null);
    }
  }

  const decide = (row: QueueRow, action: "accept" | "decline") =>
    act(
      `${row.kind}-${row.id}-${action}`,
      () =>
        apiFetch(`/api/teams/${row.teamId}/requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captainId: user?.id, requestId: row.id, action }),
        }),
      action === "accept"
        ? `${data?.player.name ?? "They"} is in ${row.teamName} 🎉`
        : `Request from ${data?.player.name ?? "that player"} declined`
    );

  const withdraw = (row: QueueRow) =>
    act(
      `withdraw-${row.id}`,
      () =>
        apiFetch(
          `/api/teams/${row.teamId}/invites?captainId=${user?.id}&inviteId=${row.id}`,
          { method: "DELETE" }
        ),
      `Invite to ${row.teamName} withdrawn`
    );

  const sendInvite = () => {
    const team = data?.captainOptions.find((t) => String(t.teamId) === inviteTeam);
    if (!team) return;
    void act(
      "invite",
      () =>
        apiFetch(`/api/teams/${team.teamId}/invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            captainId: user?.id,
            userId: data?.player.id,
            message: inviteNote.trim(),
          }),
        }),
      `Invite sent to ${data?.player.name ?? "that player"} — they decide 📨`
    );
  };

  if (loading) {
    return (
      <main className="turf-pattern min-h-screen">
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-3xl bg-white dark:bg-slate-900" />
          ))}
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="turf-pattern min-h-screen">
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <p className="text-sm font-black text-stone-700 dark:text-slate-200">
            {error || "No such player 👤"}
          </p>
          <Link
            href="/teams"
            className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back to teams
          </Link>
        </div>
      </main>
    );
  }

  const { player, stats } = data;
  const pending = data.myQueue.filter((q) => q.status === "pending");
  const history = data.myQueue.filter((q) => q.status !== "pending");
  const isSelf = data.viewer?.isSelf ?? false;
  const inviteTarget = data.captainOptions.find((t) => String(t.teamId) === inviteTeam);
  const canInvite =
    !!user &&
    !isSelf &&
    data.invitable &&
    !!inviteTarget &&
    !inviteTarget.isMember &&
    !inviteTarget.squadFull &&
    inviteTarget.invitesLeftToday > 0 &&
    !inviteTarget.hasPendingInvite &&
    !inviteTarget.hasPendingRequest;
  const joinedTeam = data.captainOptions.some((t) => t.isMember);
  /**
   * "Accept" is only honest if the squad has a seat, and the server already refuses a
   * full one — so the button says why it is off instead of failing after the tap.
   */
  const squadFullFor = (teamId: number) =>
    data.captainOptions.find((t) => t.teamId === teamId)?.squadFull ?? false;

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Link
          href="/teams"
          className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-stone-500 transition hover:text-emerald-600 dark:text-slate-400"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All teams
        </Link>

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

        {/* ------------------------------------------------------- who they are */}
        <section className={`${card} mt-4`}>
          <div className="flex flex-wrap items-start gap-4">
            <Avatar
              user={{ name: player.name, avatarColor: player.avatarColor, avatarUrl: player.avatarUrl }}
              className="h-20 w-20 text-xl"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-black text-stone-900 dark:text-slate-100">{player.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold text-stone-500 dark:text-slate-400">
                <span className="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-white/10">{player.level}</span>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-white/10">{player.position}</span>
                <span className="flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 dark:bg-white/10">
                  <MapPin className="h-3 w-3" /> {player.defaultCity}
                </span>
                {player.role !== "player" && (
                  <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                    <ShieldAlert className="h-3 w-3" /> {player.role} account
                  </span>
                )}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-slate-400">
                <PlayerRatingBadge stats={stats} />
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold dark:bg-white/10">
                  {stats.trustEmoji} {stats.trustScore} trust — {stats.trustLabel}
                </span>
                <span className="text-[11px] font-semibold text-stone-400 dark:text-slate-500">
                  on FutsalNepal since{" "}
                  {player.memberSince ? new Date(player.memberSince).toLocaleDateString() : "—"}
                </span>
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { l: "Matches", v: player.matchesPlayed },
              { l: "Games played", v: stats.completed },
              { l: "Cancelled", v: `${stats.cancelled}${stats.cancelsThisMonth ? ` (${stats.cancelsThisMonth} this month)` : ""}` },
              { l: "Reliability", v: `${stats.rating.toFixed(1)} ${stats.emoji}` },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl bg-[#FFF6E9] py-3 text-center dark:bg-white/5">
                <p className="text-lg font-black text-stone-900 dark:text-slate-100">{s.v}</p>
                <p className={label}>{s.l}</p>
              </div>
            ))}
          </div>

          {!data.invitable && (
            <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              This is a {player.role} account, not a player — squads are made of players, so there is
              nothing to invite here 🛡️
            </p>
          )}
        </section>

        {/* ------------------------------------------------------- decide, if asked */}
        {user && !isSelf && (pending.length > 0 || history.length > 0) && (
          <section className={`${card} mt-4 border-amber-200 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/5`}>
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
              <MessageSquare className="h-3.5 w-3.5" /> Between you two
            </h2>
            <p className="mt-1 text-[11px] font-semibold text-stone-500 dark:text-slate-400">
              Only your own squads can see this — nobody else&apos;s requests or invitations.
            </p>
            <ul className="mt-3 space-y-2">
              {[...pending, ...history].map((row) => (
                <li
                  key={`${row.kind}-${row.id}`}
                  className="rounded-2xl border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[10px] font-black text-white"
                      style={{ background: row.logoColor }}
                    >
                      {initials(row.teamName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-stone-900 dark:text-slate-100">
                        {row.kind === "request"
                          ? `${player.name} asked to join ${row.teamName}`
                          : row.status === "pending"
                            ? `You invited them to ${row.teamName}`
                            : `Your ${row.teamName} invite was ${row.status}`}
                      </p>
                      <p className="text-[11px] font-semibold text-stone-400 dark:text-slate-500">
                        {timeAgo(row.createdAt)}
                        {row.status !== "pending" ? ` • ${row.status}` : ""}
                      </p>
                    </div>
                    {row.kind === "request" && row.status === "pending" && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => void decide(row, "accept")}
                          disabled={busy === `request-${row.id}-accept` || squadFullFor(row.teamId)}
                          title={
                            squadFullFor(row.teamId)
                              ? "Squad is full — raise the team size in Manage first 👥"
                              : "Add them to the squad"
                          }
                          className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                          <Check className="h-3.5 w-3.5" /> Accept
                        </button>
                        <button
                          onClick={() => void decide(row, "decline")}
                          disabled={busy === `request-${row.id}-decline`}
                          className="flex items-center gap-1 rounded-xl border border-stone-200 px-3 py-2 text-[11px] font-black text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                          <X className="h-3.5 w-3.5" /> Decline
                        </button>
                      </div>
                    )}
                    {row.kind === "invite" && row.status === "pending" && (
                      <button
                        onClick={() => void withdraw(row)}
                        disabled={busy === `withdraw-${row.id}`}
                        className="rounded-xl border border-stone-200 px-3 py-2 text-[11px] font-black text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                      >
                        Withdraw invite
                      </button>
                    )}
                  </div>
                  {row.message && (
                    <p className="mt-2 rounded-xl bg-stone-50 px-3 py-2 text-[11px] italic leading-relaxed text-stone-600 dark:bg-white/5 dark:text-slate-300">
                      &ldquo;{row.message}&rdquo;
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ------------------------------------------------------- invite them */}
        {user && !isSelf && data.invitable && data.captainOptions.length > 0 && !joinedTeam && (
          <section className={`${card} mt-4`}>
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              <UserPlus className="h-3.5 w-3.5" /> Bring them into your squad
            </h2>
            <p className="mt-1 text-[11px] font-semibold leading-relaxed text-stone-500 dark:text-slate-400">
              An invitation is a question, not an add: {player.name} accepts or declines it themselves.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ThemedSelect
                value={inviteTeam}
                onChange={(e) => setInviteTeam(e.target.value)}
                className="min-w-[13rem] flex-1 rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
              >
                {data.captainOptions.map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    {t.name} — {t.memberCount}/{t.maxPlayers}
                    {t.isMember
                      ? " • already in"
                      : t.hasPendingRequest
                        ? " • asked you"
                        : t.hasPendingInvite
                          ? " • invited"
                          : t.squadFull
                            ? " • full"
                            : ` • ${t.invitesLeftToday} invites left`}
                  </option>
                ))}
              </ThemedSelect>
              <button
                onClick={sendInvite}
                disabled={!canInvite || busy === "invite"}
                title={
                  !data.invitable
                    ? "Only players can join a squad"
                    : inviteTarget?.hasPendingRequest
                      ? "They already asked to join — answer the request above"
                      : inviteTarget?.hasPendingInvite
                        ? "An invite is already waiting for their answer"
                        : inviteTarget?.isMember
                          ? "They're already in that squad"
                          : inviteTarget?.squadFull
                            ? "Squad is full — raise the team size first"
                            : inviteTarget && inviteTarget.invitesLeftToday <= 0
                              ? "Out of invites today — the count resets at midnight"
                              : "Send an invite — they decide"
                }
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Send className="h-4 w-4" /> {busy === "invite" ? "Sending…" : "Send invite"}
              </button>
            </div>
            <input
              value={inviteNote}
              onChange={(e) => setInviteNote(e.target.value)}
              maxLength={200}
              placeholder={'Why them? Optional note they\'ll see — e.g. "we need a keeper on Tuesdays"'}
              className="mt-2 w-full rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </section>
        )}

        {/* ------------------------------------------------------- their squads */}
        <section className={`${card} mt-4`}>
          <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-stone-500 dark:text-slate-400">
            <Shield className="h-3.5 w-3.5" /> Squads they play for • {data.teams.length}
          </h2>
          {data.teams.length === 0 ? (
            <p className="mt-2 text-xs font-semibold text-stone-400 dark:text-slate-500">
              Not in a squad yet — a free agent anyone&apos;s team could invite ⚽
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.teams.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/teams/${t.id}`}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-3 transition hover:border-emerald-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-emerald-500/50"
                  >
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-black text-white"
                      style={{ background: t.logoColor }}
                    >
                      {initials(t.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-black text-stone-900 dark:text-slate-100">
                        {t.name}
                        {t.role === "captain" && (
                          <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            <Crown className="h-2.5 w-2.5" /> Captain
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[11px] font-semibold text-stone-500 dark:text-slate-400">
                        {t.level} • {t.wins}W {t.draws}D {t.losses}L • {t.memberCount}/{t.maxPlayers} mates
                        {t.homeGround ? ` • ${t.homeGround}` : ""}
                      </p>
                      {(t.description || t.motto) && (
                        <p className="mt-1 line-clamp-2 text-[11px] italic text-stone-400 dark:text-slate-500">
                          {t.description || t.motto}
                        </p>
                      )}
                    </div>
                    {t.teamCode && (
                      <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 font-mono text-[10px] font-black text-stone-600 dark:bg-white/10 dark:text-slate-300">
                        <Hash className="h-2.5 w-2.5" /> {t.teamCode}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------------- games */}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className={card}>
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-stone-500 dark:text-slate-400">
              <Trophy className="h-3.5 w-3.5" /> Games they organise
            </h2>
            <MatchList rows={data.matches.organized} empty="No open match up right now." />
          </section>
          <section className={card}>
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-stone-500 dark:text-slate-400">
              <CalendarDays className="h-3.5 w-3.5" /> Games they&apos;ve joined
            </h2>
            <MatchList rows={data.matches.joined} empty="Nothing on the calendar yet." />
          </section>
        </div>

        {/* ------------------------------------------------------- reviews */}
        <section className={`${card} mt-4`}>
          <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-stone-500 dark:text-slate-400">
            <Star className="h-3.5 w-3.5" /> What they say about venues • {data.reviews.length}
          </h2>
          {data.reviews.length === 0 ? (
            <p className="mt-2 text-xs font-semibold text-stone-400 dark:text-slate-500">
              No reviews written yet — playing first, talking later 😄
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.reviews.map((r) => (
                <li key={r.id} className="rounded-2xl bg-stone-50 px-3.5 py-3 dark:bg-white/5">
                  <p className="flex items-center gap-1.5 text-xs font-black text-stone-900 dark:text-slate-100">
                    <span className="text-amber-500">
                      {"★".repeat(r.rating)}
                      <span className="text-stone-300 dark:text-slate-600">{"★".repeat(5 - r.rating)}</span>
                    </span>
                    {r.venueName}
                  </p>
                  {r.message && (
                    <p className="mt-1 text-[11px] leading-relaxed text-stone-500 dark:text-slate-400">
                      {r.message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function MatchList({ rows, empty }: { rows: MatchRow[]; empty: string }) {
  if (rows.length === 0)
    return <p className="mt-2 text-xs font-semibold text-stone-400 dark:text-slate-500">{empty}</p>;
  return (
    <ul className="mt-3 space-y-1.5">
      {rows.map((m) => (
        <li
          key={m.id}
          className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 text-xs dark:bg-white/5"
        >
          <span className="grid h-8 w-10 shrink-0 place-items-center rounded-lg bg-white text-[10px] font-black text-stone-600 dark:bg-slate-900 dark:text-slate-300">
            {m.date.slice(5)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-black text-stone-900 dark:text-slate-100">{m.title}</span>
            <span className="block truncate text-[10px] font-semibold text-stone-400 dark:text-slate-500">
              {m.startTime}–{m.endTime}
              {m.venueName ? ` • ${m.venueName}` : ""} • Rs. {m.pricePerPlayer}
            </span>
          </span>
          <Link
            href="/matches"
            className="shrink-0 text-[10px] font-black uppercase tracking-wider text-emerald-600 hover:underline"
          >
            open match
          </Link>
        </li>
      ))}
    </ul>
  );
}
