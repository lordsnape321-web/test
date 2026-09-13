import { db } from "@/db";
import { teams, teamMembers, users } from "@/db/schema";
import { validateTitle, validateMessage, firstError } from "@/lib/validation";

export const dynamic = "force-dynamic";

const LEVELS = ["Beginner", "Intermediate", "Advanced"];

export async function GET() {
  try {
    const allTeams = await db.select().from(teams);
    const members = await db.select().from(teamMembers);
    const allUsers = await db.select().from(users);
    const enriched = allTeams.map((t) => {
      const tm = members.filter((m) => m.teamId === t.id);
      const players = tm
        .map((m) => allUsers.find((u) => u.id === m.userId))
        .filter(Boolean);
      const captain = allUsers.find((u) => u.id === t.captainId);
      return {
        ...t,
        memberCount: tm.length,
        players,
        captainName: captain?.name ?? "—",
      };
    });
    return Response.json({ teams: enriched });
  } catch (e) {
    return Response.json({ teams: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    const motto = String(body.motto ?? "").trim();
    const homeGround = String(body.homeGround ?? "").trim();
    const captainId = Number(body.captainId);

    const err = firstError(
      validateTitle(name, { min: 3, max: 50, label: "Team name" }),
      motto ? validateMessage(motto, { min: 3, max: 120, label: "Motto", required: false }) : null,
      homeGround && homeGround.length > 100 ? "Home ground is too long (max 100 characters) 📍" : null,
      !Number.isInteger(captainId) || captainId <= 0 ? "Login to start a team 🔒" : null,
      body.level && !LEVELS.includes(String(body.level)) ? "Pick a valid level 🌱⚡🔥" : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    const maxPlayers = Number(body.maxPlayers ?? 12);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 4 || maxPlayers > 30)
      return Response.json({ error: "Team size must be 4–30 players 👥" }, { status: 400 });

    const inserted = await db
      .insert(teams)
      .values({
        name,
        motto,
        captainId,
        maxPlayers,
        level: body.level ?? "Intermediate",
        logoColor: body.logoColor ?? "#16a34a",
        homeGround,
        lookingForPlayers: body.lookingForPlayers ?? true,
      })
      .returning();
    await db.insert(teamMembers).values({
      teamId: inserted[0].id,
      userId: captainId,
      role: "captain",
    });
    return Response.json({ team: inserted[0] }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
