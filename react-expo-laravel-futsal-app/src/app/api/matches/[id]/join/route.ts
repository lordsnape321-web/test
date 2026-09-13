import { db } from "@/db";
import { matchJoins, openMatches, users } from "@/db/schema";
import { sendNotification } from "@/lib/notify";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const matchId = Number(id);
    const body = await req.json();
    const userId = Number(body.userId);
    if (!Number.isInteger(matchId) || matchId <= 0)
      return Response.json({ error: "Invalid match ⚽" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Login to join 🔒" }, { status: 400 });

    const existing = await db
      .select()
      .from(matchJoins)
      .where(and(eq(matchJoins.matchId, matchId), eq(matchJoins.userId, userId)));
    if (existing.length > 0)
      return Response.json({ ok: true, message: "Already joined" });

    const matchRows = await db
      .select()
      .from(openMatches)
      .where(eq(openMatches.id, matchId));
    const match = matchRows[0];
    if (!match) return Response.json({ error: "Match not found" }, { status: 404 });
    if (match.status !== "open") {
      return Response.json(
        { error: "This match is not open for joining yet" },
        { status: 409 }
      );
    }
    const allJoins = await db
      .select()
      .from(matchJoins)
      .where(eq(matchJoins.matchId, matchId));
    const crewSize = match.crewSize ?? 1;
    const otherJoined = allJoins.filter((j) => j.userId !== match.organizerId).length;
    const totalTaken = crewSize + otherJoined;
    if (totalTaken >= match.maxPlayers) {
      return Response.json({ error: "Match is full — that crew filled fast! ⚡" }, { status: 409 });
    }

    await db.insert(matchJoins).values({ matchId, userId });

    // Notify the organizer that someone joined.
    if (match.organizerId && match.organizerId !== userId) {
      const joiner = await db.select().from(users).where(eq(users.id, userId));
      await sendNotification({
        userId: match.organizerId,
        type: "match_join",
        title: `🙋 ${joiner[0]?.name ?? "A player"} joined your match`,
        message: `"${match.title}" now has ${totalTaken + 1}/${match.maxPlayers} players (👥 ${crewSize} crew + 🙋 ${otherJoined + 1} joined).`,
        link: "/matches",
      });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId"));
    if (!Number.isInteger(Number(id)) || Number(id) <= 0)
      return Response.json({ error: "Invalid match ⚽" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Login required 🔒" }, { status: 400 });
    const rows = await db
      .select()
      .from(matchJoins)
      .where(
        and(eq(matchJoins.matchId, Number(id)), eq(matchJoins.userId, userId))
      );
    for (const r of rows) {
      await db.delete(matchJoins).where(eq(matchJoins.id, r.id));
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
