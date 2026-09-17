"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Crown,
  Hash,
  Hourglass,
  LogIn,
  MailQuestion,
  MapPin,
  Send,
  Settings,
  Shield,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { Avatar } from "@/components/Avatar";
import { initials } from "@/lib/futsal";
import { timeAgo } from "@/components/NotificationBell";

type Team = {
  id: number;
  name: string;
  motto: string;
  description: string;
  teamCode: string;
  level: string;
  logoColor: string;
  maxPlayers: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  gamesPlayed: number;
  homeGround: string;
  homeVenueId: number | null;
  lookingForPlayers: boolean;
  captainId: number;
  captainName: string;
  memberCount: number;
};

type RosterRow = {
  userId: number;
  name: string;
  email: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  role: string;
  isCaptain: boolean;
  joinedAt: string | null;
};

type RequestRow = {
  id: number;
  userId: number;
  name: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  message: string;
  status: string;
  createdAt: string | null;
};

type InviteRow = {
  id: number;
  userId: number;
  name: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  message: string;
  status: string;
  createdAt: string | null;
};

/** A squad's record across one league it played in — see `teamCompetitionProfile`. */
type TeamLeagueRow = {
  tournamentId: number;
  name: string;
  status: string;
  format: string;
  venueName: string;
  startsAt: string;
  record: {
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDiff: number;
    points: number;
    form: string[];
  };
  standing: number | null;
  tableSize: number;
};

/**
 * League & competition profile 🏆 — merged from the host-scored league fixtures
 * and the competition bookings a venue owner scored. It rides along on the team
 * API, and is public: a record a squad earned is part of who they are.
 */
type CompetitionProfile = {
  record: TeamLeagueRow["record"];
  leagues: TeamLeagueRow[];
  results: Array<{
    id: number;
    source: "league" | "booking";
    leagueId: number | null;
    leagueName: string;
    round: string;
    opponent: string;
    opponentId: number | null;
    home: boolean;
    scored: number;
    conceded: number;
    outcome: "W" | "D" | "L";
    date: string;
    link: string;
  }>;
};

type Detail = {
  team: Team;
  competition: CompetitionProfile;
  roster: RosterRow[];
  viewer: {
    isMember: boolean;
    isCaptain: boolean;
    requestStatus: string | null;
    requestId: number | null;
    inviteStatus: string | null;
    inviteId: number | null;
  } | null;
  /** Present only when the viewer is the captain, checked on the server. */
  captain?: {
    pendingRequests: RequestRow[];
    requestHistory: RequestRow[];
    invites: InviteRow[];
    quota: { used: number; limit: number; left: number };
  };
};

const card =
  "rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-[0_10px_30px_rgba(180,120,60,0.08)] dark:border-white/10 dark:bg-stone-900";
const head =
  "text-xs font-black uppercase tracking-widest text-stone-500 dark:text-stone-400";

/**
 * One squad, in full 🛡️
 *
 * The list page has to fit a dozen teams on a screen, so a card can only show a
 * clamped line. This page is what a player should read before asking to join — or
 * before answering an invitation: the whole description, the record, every name
 * in the squad (each one a link to that player's dossier), and the button that
 * matches the truth of where they stand.
 */
export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useUser();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeBad, setNoticeBad] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/teams/${id}${user ? `?viewerId=${user.id}` : ""}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error ?? "Couldn't load that squad 🙏"));
      setData(body as Detail);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that squad 🙏");
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (alive) await load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

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

  if (loading) {
    return (
      <main className="turf-pattern min-h-screen">
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-3xl bg-white dark:bg-stone-900" />
          ))}
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="turf-pattern grid min-h-screen place-items-center px-4">
        <div className="text-center">
          <p className="text-sm font-black text-stone-700 dark:text-stone-200">
            {error || "No such squad 🛡️"}
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

  const { team, roster, viewer } = data;
  const captain = data.captain;
  // Older responses (or a squad nobody has competed against yet) carry an empty
  // profile rather than null, so the section can be skipped with one check.
  const comp: CompetitionProfile =
    data.competition ?? { record: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, form: [] }, leagues: [], results: [] };
  const pendingInvite =
    viewer?.inviteStatus === "pending" && viewer?.inviteId ? viewer.inviteId : null;
  const requested = viewer?.requestStatus === "pending";
  const squadFull = roster.length >= team.maxPlayers;

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Link
          href="/teams"
          className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-stone-500 transition hover:text-emerald-600 dark:text-stone-400"
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

        {/* ------------------------------------------------------- the squad */}
        <section className={`${card} mt-4`}>
          <div className="flex flex-wrap items-start gap-4">
            <span
              className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl text-2xl font-black text-white shadow-lg"
              style={{ background: `linear-gradient(135deg, ${team.logoColor}, #44403c)` }}
            >
              {initials(team.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black text-stone-900 dark:text-stone-100">{team.name}</h1>
                {team.lookingForPlayers && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    Welcoming new friends
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs italic text-stone-400 dark:text-stone-500">
                &quot;{team.motto || "Come play with us!"}&quot;
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-bold text-stone-500 dark:text-stone-400">
                <span className="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-white/10">{team.level}</span>
                {team.teamCode && (
                  <span className="flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 font-mono dark:bg-white/10">
                    <Hash className="h-3 w-3" /> {team.teamCode}
                  </span>
                )}
                <Link
                  href={`/players/${team.captainId}`}
                  className="flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 hover:bg-stone-200 dark:bg-white/10 dark:hover:bg-white/20"
                  title="Who runs this squad"
                >
                  <Crown className="h-3 w-3 text-amber-500" /> {team.captainName}
                </Link>
                {team.homeGround && (
                  <span className="flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 dark:bg-white/10">
                    <MapPin className="h-3 w-3" />
                    {team.homeVenueId ? (
                      <Link href={`/venues/${team.homeVenueId}`} className="hover:underline">
                        {team.homeGround}
                      </Link>
                    ) : (
                      team.homeGround
                    )}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* The whole thing — no clamping, no tooltip, no "read more". */}
          {team.description ? (
            <p className="mt-4 whitespace-pre-line rounded-2xl bg-[#FFF6E9] px-4 py-3 text-sm leading-relaxed text-stone-700 dark:bg-white/5 dark:text-stone-200">
              {team.description}
            </p>
          ) : (
            <p className="mt-4 rounded-2xl border border-dashed border-stone-200 px-4 py-3 text-xs font-semibold text-stone-400 dark:border-white/10 dark:text-stone-500">
              {viewer?.isCaptain
                ? "You haven't written a description yet — players read this before asking to join, so a couple of lines about training nights and how you split the bill goes a long way ✍️"
                : "This squad hasn't written a description yet — ask the captain what to expect 🤝"}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { l: "Record", v: `${team.wins}W ${team.draws}D ${team.losses}L` },
              { l: "Win rate", v: `${team.winRate}%` },
              { l: "Games played", v: team.gamesPlayed },
              { l: "Squad size", v: `${roster.length}/${team.maxPlayers}` },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl bg-[#FFF6E9] py-3 text-center dark:bg-white/5">
                <p className="text-base font-black text-stone-900 dark:text-stone-100">{s.v}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  {s.l}
                </p>
              </div>
            ))}
          </div>

          {/* ---------------------------------------------------- your move */}
          <div className="mt-4">
            {!user ? (
              <Link
                href="/login"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-900 py-3 text-sm font-black text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900"
              >
                <LogIn className="h-4 w-4" /> Log in to see your standing with this squad
              </Link>
            ) : viewer?.isCaptain ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/teams"
                  className="flex items-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-white hover:bg-amber-600"
                >
                  <Settings className="h-4 w-4" /> Manage your squad
                </Link>
                <span className="text-[11px] font-bold text-stone-400 dark:text-stone-500">
                  <Send className="mr-1 inline h-3 w-3" />
                  {captain?.quota.left ?? 0} of {captain?.quota.limit ?? 5} invites left today
                </span>
              </div>
            ) : pendingInvite ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/5">
                <p className="flex items-center gap-1.5 text-sm font-black text-emerald-700 dark:text-emerald-300">
                  <Send className="h-4 w-4" /> {team.captainName} invited you to join 🎉
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-relaxed text-stone-500 dark:text-stone-400">
                  Nothing changes until you answer. Read the roster and the description above — that is
                  who you would be playing with.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() =>
                      void act(
                        "accept",
                        () =>
                          fetch("/api/team-invites", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              userId: user.id,
                              inviteId: pendingInvite,
                              action: "accept",
                            }),
                          }),
                        `You're in ${team.name} 🎉`
                      )
                    }
                    disabled={busy === "accept" || squadFull}
                    title={squadFull ? `Squad is full (${roster.length}/${team.maxPlayers})` : "Join this squad"}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    <Check className="h-4 w-4" /> {busy === "accept" ? "One sec…" : "Accept & join"}
                  </button>
                  <button
                    onClick={() =>
                      void act(
                        "decline",
                        () =>
                          fetch("/api/team-invites", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              userId: user.id,
                              inviteId: pendingInvite,
                              action: "decline",
                            }),
                          }),
                        `You declined ${team.name}`
                      )
                    }
                    disabled={busy === "decline"}
                    className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-black text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/10"
                  >
                    <X className="h-4 w-4" /> Decline
                  </button>
                </div>
              </div>
            ) : (
              <>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={200}
                  placeholder="Optional note for the captain — a line about how you play goes a long way"
                  className="w-full resize-y rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-stone-100 dark:placeholder:text-stone-500"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {requested ? (
                    <button
                      onClick={() =>
                        void act(
                          "withdraw",
                          () =>
                            fetch(`/api/teams/${team.id}/join?userId=${user.id}`, { method: "DELETE" }),
                          `Request to join ${team.name} withdrawn`
                        )
                      }
                      disabled={busy === "withdraw"}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 py-3 text-sm font-black text-amber-700 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                    >
                      <Hourglass className="h-4 w-4" /> Request pending ⏳ — tap to withdraw
                    </button>
                  ) : viewer?.isMember ? (
                    <button
                      onClick={() =>
                        void act(
                          "leave",
                          () =>
                            fetch(`/api/teams/${team.id}/join?userId=${user.id}`, { method: "DELETE" }),
                          `You've stepped away from ${team.name}`
                        )
                      }
                      disabled={busy === "leave"}
                      className="flex-1 rounded-2xl border border-stone-200 bg-stone-50 py-3 text-sm font-black text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10"
                    >
                      Take a break from the team
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        void act(
                          "ask",
                          () =>
                            fetch(`/api/teams/${team.id}/join`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ userId: user.id, message: note.trim() }),
                            }),
                          `Request sent — ${team.name}'s captain will review it 👑`
                        )
                      }
                      disabled={busy === "ask" || squadFull}
                      title={squadFull ? `Squad is full (${roster.length}/${team.maxPlayers})` : "Ask the captain"}
                      className="flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      {busy === "ask" ? "Sending…" : squadFull ? "Squad is full 👥" : "Request to join 🛡️"}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[10px] font-bold text-stone-400 dark:text-stone-500">
                  A captain accepts or declines you — five asks a day each way keeps it fair for both
                  sides 🌙
                </p>
              </>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------- captain's queue */}
        {viewer?.isCaptain && captain && (
          <section className={`${card} mt-4 border-amber-200 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/5`}>
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
              <Users className="h-3.5 w-3.5" /> Players waiting on you • {captain.pendingRequests.length}
            </h2>
            {captain.pendingRequests.length === 0 ? (
              <p className="mt-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
                Nobody waiting right now 🎉 Share the code {team.teamCode || "—"} so players can find you.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {captain.pendingRequests.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-stone-900"
                  >
                    <Link href={`/players/${r.userId}`} title="See their full details">
                      <Avatar
                        user={{ name: r.name, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl }}
                        className="h-9 w-9 text-[11px]"
                      />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-stone-900 dark:text-stone-100">
                        <Link href={`/players/${r.userId}`} className="hover:underline">
                          {r.name}
                        </Link>
                      </p>
                      <p className="truncate text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                        {r.level} • {r.position} • asked {timeAgo(r.createdAt)}
                      </p>
                      {r.message && (
                        <p className="mt-1 text-[11px] italic text-stone-500 dark:text-stone-400">
                          &ldquo;{r.message}&rdquo;
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() =>
                          void act(
                            `req-${r.id}-accept`,
                            () =>
                              fetch(`/api/teams/${team.id}/requests`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ captainId: user?.id, requestId: r.id, action: "accept" }),
                              }),
                            `${r.name} is in the squad 🎉`
                          )
                        }
                        disabled={busy === `req-${r.id}-accept` || squadFull}
                        className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black text-white hover:bg-emerald-700 disabled:opacity-40"
                      >
                        <Check className="h-3.5 w-3.5" /> Accept
                      </button>
                      <button
                        onClick={() =>
                          void act(
                            `req-${r.id}-decline`,
                            () =>
                              fetch(`/api/teams/${team.id}/requests`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ captainId: user?.id, requestId: r.id, action: "decline" }),
                              }),
                            `${r.name}'s request declined`
                          )
                        }
                        disabled={busy === `req-${r.id}-decline`}
                        className="flex items-center gap-1 rounded-xl border border-stone-200 px-3 py-2 text-[11px] font-black text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/10"
                      >
                        <X className="h-3.5 w-3.5" /> Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {captain.invites.filter((i) => i.status === "pending").length > 0 && (
              <div className="mt-3 rounded-2xl bg-white/70 p-3 dark:bg-stone-950/60">
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-stone-500 dark:text-stone-400">
                  <MailQuestion className="h-3 w-3" /> Invitations awaiting an answer
                </p>
                <ul className="mt-2 space-y-1.5">
                  {captain.invites
                    .filter((i) => i.status === "pending")
                    .map((i) => (
                      <li key={i.id} className="flex items-center gap-2 text-xs">
                        <Link
                          href={`/players/${i.userId}`}
                          className="min-w-0 flex-1 truncate font-bold text-stone-700 hover:underline dark:text-stone-200"
                        >
                          {i.name} — {i.level} • {i.position}
                        </Link>
                        <span className="shrink-0 text-[10px] font-bold text-stone-400">
                          {timeAgo(i.createdAt)}
                        </span>
                        <button
                          onClick={() =>
                            void act(
                              `wd-${i.id}`,
                              () =>
                                fetch(
                                  `/api/teams/${team.id}/invites?captainId=${user?.id}&inviteId=${i.id}`,
                                  { method: "DELETE" }
                                ),
                              `Invite to ${i.name} withdrawn`
                            )
                          }
                          disabled={busy === `wd-${i.id}`}
                          className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-black text-stone-500 hover:bg-stone-100 disabled:opacity-40 dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/10"
                        >
                          Withdraw
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ------------------------------------- league & competition record */}
        {comp && (comp.record.played > 0 || comp.leagues.length > 0) && (
          <section className={`${card} mt-4`}>
            <h2 className={`flex items-center gap-2 ${head}`}>
              <Trophy className="h-3.5 w-3.5" /> League &amp; competition
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { l: "Played", v: comp.record.played },
                { l: "Record", v: `${comp.record.won}W ${comp.record.drawn}D ${comp.record.lost}L` },
                { l: "Goals", v: `${comp.record.goalsFor}:${comp.record.goalsAgainst}` },
                { l: "Competition pts", v: comp.record.points },
              ].map((s) => (
                <div key={s.l} className="rounded-2xl bg-[#FFF6E9] py-3 text-center dark:bg-white/5">
                  <p className="text-base font-black text-stone-900 dark:text-stone-100">{s.v}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    {s.l}
                  </p>
                </div>
              ))}
            </div>

            {comp.leagues.length > 0 && (
              <ul className="mt-3 space-y-2">
                {comp.leagues.map((l) => (
                  <li key={l.tournamentId}>
                    <Link
                      href={`/leagues/${l.tournamentId}`}
                      className="flex flex-wrap items-center gap-2 rounded-2xl bg-stone-50 px-3.5 py-2.5 transition hover:bg-emerald-50 dark:bg-white/5 dark:hover:bg-emerald-500/10"
                    >
                      <span className="text-sm font-bold text-stone-900 dark:text-stone-100">{l.name}</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-black text-stone-600 dark:bg-white/10 dark:text-stone-300">
                        {l.status === "ongoing" ? "⚽ In progress" : l.status === "completed" ? "🏁 Finished" : l.status === "registration" ? "📝 Entries open" : "🚫 Cancelled"}
                      </span>
                      {l.standing && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          {l.standing}
                          {l.standing === 1 ? "st" : l.standing === 2 ? "nd" : l.standing === 3 ? "rd" : "th"} of {l.tableSize}
                        </span>
                      )}
                      <span className="ml-auto text-[11px] font-bold text-stone-400 dark:text-stone-500">
                        {l.format} • {l.record.played}P {l.record.points}pts
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {comp.results.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Recent results
                </p>
                <ul className="mt-2 divide-y divide-stone-100 dark:divide-white/5">
                  {comp.results.slice(0, 6).map((r) => (
                    <li key={`${r.source}-${r.id}`} className="flex items-center gap-2.5 py-2">
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-black text-white ${
                          r.outcome === "W" ? "bg-emerald-600" : r.outcome === "D" ? "bg-stone-400" : "bg-red-500"
                        }`}
                      >
                        {r.outcome}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-stone-900 dark:text-stone-100">
                          {r.home ? "vs" : "at"} {r.opponent}
                        </span>
                        <span className="block truncate text-[11px] text-stone-400 dark:text-stone-500">
                          {r.leagueName}
                          {r.source === "booking" ? " • venue-scored" : ` • ${r.round}`} • {r.date}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-black text-stone-900 dark:text-stone-100">
                        {r.scored}–{r.conceded}
                      </span>
                      <Link
                        href={r.link}
                        className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-black text-stone-500 hover:bg-stone-100 dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/10"
                      >
                        {r.source === "booking" ? "Booking" : "Table"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
              🏆 League fixtures are scored by the host; competition bookings by the venue owner.
              Both count on this record.
            </p>
          </section>
        )}

        {/* ---------------------------------------------------- the roster */}
        <section className={`${card} mt-4`}>
          <h2 className={`flex items-center gap-2 ${head}`}>
            <Shield className="h-3.5 w-3.5" /> The squad • {roster.length}/{team.maxPlayers}
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {roster.map((m) => (
              <li key={m.userId}>
                <Link
                  href={`/players/${m.userId}`}
                  className="flex items-center gap-2.5 rounded-2xl bg-stone-50 px-3 py-2.5 transition hover:bg-emerald-50 dark:bg-white/5 dark:hover:bg-emerald-500/10"
                  title={`See ${m.name}'s full details`}
                >
                  <Avatar
                    user={{ name: m.name, avatarColor: m.avatarColor, avatarUrl: m.avatarUrl }}
                    className="h-9 w-9 text-[11px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-bold text-stone-900 dark:text-stone-100">
                      {m.name}
                      {m.isCaptain && (
                        <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          <Crown className="h-2.5 w-2.5" /> Captain
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-stone-400 dark:text-stone-500">
                      {m.level} • {m.position}
                      {m.email ? ` • ${m.email}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
            <Trophy className="h-3 w-3" /> Tap any name for that player&apos;s full details — level,
            reliability, and the other squads they play for.
          </p>
        </section>
      </div>
    </main>
  );
}
