import { db } from "@/db";
import { tournamentMatches, tournamentMedia, tournaments, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import { approvedSquads, canViewMedia, leagueAccess } from "@/lib/league-store";
import { validateExternalUrl } from "@/lib/validation";

export const dynamic = "force-dynamic";

const MAX_MEDIA_CHARS = 2000000; // ~2MB data URL, same ceiling as receipts

/**
 * GET /api/tournaments/[id]/media — the album 📸
 *
 * Photos are the most private thing in a league, so the guest list is explicit:
 *
 * - the **host** sees everything they uploaded,
 * - a squad in the league sees the league-wide album,
 * - a **fixture's** album belongs to the two squads that played it, nobody else
 *   — not the rest of the league, not the losing captain's cousin.
 *
 * The filter runs on the server for every read, because hiding rows in the UI
 * would still ship them over the wire.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ media: [], error: "Invalid league 🛡️" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId") ?? 0) || 0;
    const access = await leagueAccess(leagueId, userId);
    if (!access)
      return Response.json({ media: [], error: "That league no longer exists 🛡️" }, { status: 404 });

    const [rows, matches, allUsers] = await Promise.all([
      db.select().from(tournamentMedia).where(eq(tournamentMedia.tournamentId, leagueId)),
      db.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, leagueId)),
      db.select().from(users),
    ]);

    const viewer = {
      isHost: access.isHost,
      teamIds: access.myTeamIds,
      canSeeInside: access.canSeeInside,
    };

    const media = rows
      .filter((m) => {
        const match = m.matchId ? matches.find((x) => x.id === m.matchId) : null;
        const squads = match ? [match.homeTeamId, match.awayTeamId] : [];
        return canViewMedia({ matchId: m.matchId }, squads, viewer);
      })
      .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))
      .map((m) => {
        const match = m.matchId ? matches.find((x) => x.id === m.matchId) : null;
        return {
          id: m.id,
          matchId: m.matchId,
          kind: m.kind,
          url: m.url,
          caption: m.caption,
          credit: m.credit,
          uploadedBy: m.uploadedBy,
          uploaderName: allUsers.find((u) => u.id === m.uploadedBy)?.name ?? "Host",
          createdAt: m.createdAt,
          scope: match ? `${match.round} • a fixture album` : "Whole league",
          canDelete: access.isHost && m.uploadedBy === userId,
        };
      });

    return Response.json({ media, canUpload: access.isHost, isHost: access.isHost });
  } catch (e) {
    console.error(`[/api/tournaments/[id]/media GET] failed:`, e);
    return Response.json({ media: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/tournaments/[id]/media — upload a photo, or paste an album link 🔗
 *
 * Only the host uploads: a league album is the organiser's record of the
 * season, and one camera is easier to keep tidy than twenty. Everything else —
 * the visibility rule, the caption, the link validation — is shared.
 *
 * `kind` decides what `url` is: `file` holds a data URL the browser read off the
 * host's disk (the same trick the receipt uploader uses, no storage service
 * needed), `link` holds an https:// address of an album on Google Drive,
 * Facebook or wherever the host already keeps photos.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "add");
    const userId = Number(body.userId);

    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ error: "Invalid league 🛡️" }, { status: 400 });

    const league = (await db.select().from(tournaments).where(eq(tournaments.id, leagueId)))[0];
    if (!league) return Response.json({ error: "That league no longer exists 🛡️" }, { status: 404 });
    if (league.hostId !== userId)
      return Response.json(
        { error: "Only the host adds to the album 👑 — send them your photos and they'll post them." },
        { status: 403 }
      );

    if (action === "delete") {
      const mediaId = Number(body.mediaId);
      const row = (await db.select().from(tournamentMedia).where(eq(tournamentMedia.id, mediaId)))[0];
      if (!row || row.tournamentId !== leagueId)
        return Response.json({ error: "That photo isn't in this league 📸" }, { status: 404 });
      await db.delete(tournamentMedia).where(eq(tournamentMedia.id, mediaId));
      return Response.json({ ok: true, message: "Removed from the album 🗑️" });
    }

    if (action !== "add")
      return Response.json({ error: "Unknown action — add or delete 📸" }, { status: 400 });

    const kind = String(body.kind ?? "link") === "file" ? "file" : "link";
    const url = String(body.url ?? "").trim();
    const caption = String(body.caption ?? "").trim().slice(0, 160);
    const credit = String(body.credit ?? "").trim().slice(0, 80);
    const matchId = Number(body.matchId) || null;

    if (!url) return Response.json({ error: "Add a photo or paste a link first 📸" }, { status: 400 });
    if (kind === "link") {
      const err = validateExternalUrl(url);
      if (err) return Response.json({ error: err }, { status: 400 });
    } else if (!url.startsWith("data:image/")) {
      return Response.json(
        { error: "That upload didn't come through as an image — try again 📸" },
        { status: 400 }
      );
    }
    if (url.length > MAX_MEDIA_CHARS)
      return Response.json(
        { error: "That photo is over 2MB — a smaller one, or paste a Drive link instead 🔗" },
        { status: 400 }
      );

    if (matchId) {
      const match = (
        await db.select().from(tournamentMatches).where(eq(tournamentMatches.id, matchId))
      )[0];
      if (!match || match.tournamentId !== leagueId)
        return Response.json({ error: "That fixture isn't in this league 🛡️" }, { status: 400 });
    }

    const rows = await db
      .insert(tournamentMedia)
      .values({
        tournamentId: leagueId,
        matchId,
        kind,
        url,
        caption,
        credit,
        uploadedBy: userId,
      })
      .returning();

    // Tell the squads who can actually see it. A fixture photo goes to the two
    // captains; a league-wide one goes to every squad in the league — and to
    // nobody else, which is the same rule the GET above enforces.
    const squads = await approvedSquads(leagueId);
    let audience: number[] = squads.map((s) => s.captainId);
    if (matchId) {
      const match = (
        await db.select().from(tournamentMatches).where(eq(tournamentMatches.id, matchId))
      )[0];
      const ids = new Set([match?.homeTeamId, match?.awayTeamId]);
      audience = squads.filter((s) => ids.has(s.teamId)).map((s) => s.captainId);
    }
    await notifyAlbum(leagueId, league.name, caption, matchId, audience);

    return Response.json({
      ok: true,
      media: rows[0],
      message: matchId
        ? "Added to that fixture's album — the two squads and you can see it 📸"
        : "Added to the league album — every squad in it can see it 📸",
    });
  } catch (e) {
    console.error(`[/api/tournaments/[id]/media POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * Tell the people who can see the photo that it exists.
 *
 * Kept local (not exported) on purpose: a route module may only export HTTP
 * handlers, so a shared helper would have to live in `lib` — and this one is
 * used exactly once, right where the rule it mirrors lives.
 */
async function notifyAlbum(
  leagueId: number,
  tournamentName: string,
  caption: string,
  matchId: number | null,
  captainIds: number[]
) {
  for (const captainId of captainIds) {
    await sendNotification({
      userId: captainId,
      type: "league",
      title: `📸 New ${matchId ? "match" : "league"} photos — ${tournamentName}`,
      message: caption || "The host added photos from the league. Open the album to see them.",
      link: `/leagues/${leagueId}`,
    });
  }
}
