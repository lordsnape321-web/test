import { db } from "@/db";
import { openMatches, matchJoins, venues, users, courts } from "@/db/schema";
import { validateTitle, validateMessage, validateMoney, validateCrew, validateTotalPlayers, validateDateISO, validateTimeHM, firstError } from "@/lib/validation";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const all = await db
      .select()
      .from(openMatches)
      .orderBy(desc(openMatches.createdAt));
    const list = all.filter((m) => m.status === "open");
    const joins = await db.select().from(matchJoins);
    const allVenues = await db.select().from(venues);
    const allUsers = await db.select().from(users);
    const allCourts = await db.select().from(courts);

    const enriched = list.map((m) => {
      const jm = joins.filter((j) => j.matchId === m.id);
      const players = jm
        .map((j) => allUsers.find((u) => u.id === j.userId))
        .filter(Boolean);
      const crewSize = m.crewSize ?? 1;
      const otherJoined = jm.filter((j) => j.userId !== m.organizerId).length;
      const joinedCount = crewSize + otherJoined;
      return {
        ...m,
        joinedCount,
        otherJoined,
        crewSize,
        openSpots: Math.max(0, m.maxPlayers - crewSize),
        spotsLeft: Math.max(0, m.maxPlayers - joinedCount),
        players,
        venue: allVenues.find((v) => v.id === m.venueId),
        court: allCourts.find((c) => c.id === m.courtId),
        organizer: allUsers.find((u) => u.id === m.organizerId),
      };
    });
    return Response.json({ matches: enriched });
  } catch (e) {
    console.error(`[/api/matches GET] failed:`, e);
    return Response.json({ matches: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = String(body.title ?? "").trim();
    const desc = String(body.description ?? "").trim();
    const venueId = Number(body.venueId);
    const organizerId = Number(body.organizerId);
    const date = String(body.date ?? "");
    const startTime = String(body.startTime ?? "");
    const price = body.pricePerPlayer;

    const err = firstError(
      validateTitle(title, { min: 3, max: 60, label: "Game title" }),
      !Number.isInteger(venueId) || venueId <= 0 ? "Pick where you're playing 📍" : null,
      !Number.isInteger(organizerId) || organizerId <= 0 ? "Login to host a game 🔒" : null,
      validateDateISO(date, { label: "Game day", maxDaysAhead: 60 }),
      validateTimeHM(startTime, "Start time"),
      validateMoney(price, { min: 0, max: 2000, label: "Price per friend" }),
      desc ? validateMessage(desc, { min: 3, max: 500, label: "Note", required: false }) : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    let crewSize = Math.max(1, Number(body.crewSize ?? body.ourCrew ?? 1) || 1);
    let total = Number(body.maxPlayers ?? 0) || 0;
    const openSpotsInput = Number(body.openSpots ?? 0) || 0;
    if (openSpotsInput > 0 || body.crewSize || body.ourCrew) {
      const crewErr = validateCrew(crewSize, { min: 1, max: 21, label: "Our crew" });
      if (crewErr) return Response.json({ error: crewErr }, { status: 400 });
      const openErr = validateCrew(openSpotsInput || 1, { min: 1, max: 21, label: "Open spots" });
      if (openSpotsInput > 0 && openErr) return Response.json({ error: openErr }, { status: 400 });
      const open = Math.max(1, openSpotsInput || Math.max(1, total - crewSize));
      crewSize = Math.min(21, crewSize);
      total = Math.min(22, Math.max(4, crewSize + open));
    } else {
      total = Math.min(22, Math.max(4, total || 10));
      crewSize = Math.min(crewSize, Math.max(1, total - 1));
    }
    const totalErr = validateTotalPlayers(total);
    if (totalErr) return Response.json({ error: totalErr }, { status: 400 });

    const level = String(body.level ?? "All Levels");
    const allowedLevels = ["All Levels", "Beginner", "Intermediate", "Advanced"];
    const levelParts = level.split("+").map((s: string) => s.trim()).filter(Boolean);
    if (level !== "All Levels" && (levelParts.length === 0 || !levelParts.every((p: string) => allowedLevels.includes(p))))
      return Response.json({ error: "Pick valid levels 🌍🎯" }, { status: 400 });

    const chargeMode = body.chargeMode === "custom" ? "custom" : "split";
    const inserted = await db
      .insert(openMatches)
      .values({
        title,
        venueId,
        courtId: body.courtId ? Number(body.courtId) : null,
        organizerId,
        date,
        startTime,
        endTime: String(body.endTime ?? ""),
        pricePerPlayer: Number(price),
        maxPlayers: total,
        crewSize,
        level,
        description: desc,
        status: "open",
        chargeMode,
      })
      .returning();
    await db.insert(matchJoins).values({
      matchId: inserted[0].id,
      userId: organizerId,
    });
    return Response.json({ match: inserted[0] }, { status: 201 });
  } catch (e) {
    console.error(`[/api/matches POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
