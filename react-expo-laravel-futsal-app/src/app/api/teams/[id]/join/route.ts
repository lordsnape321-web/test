import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    const body = await req.json();
    const userId = Number(body.userId);
    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Login to join a team 🔒" }, { status: 400 });
    const existing = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    if (existing.length > 0)
      return Response.json({ ok: true, message: "Already a member" });
    await db.insert(teamMembers).values({ teamId, userId, role: "player" });
    return Response.json({ ok: true });
  } catch (e) {
    console.error(`[/api/teams/[id]/join POST] failed:`, e);
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
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Login required 🔒" }, { status: 400 });
    const rows = await db
      .select()
      .from(teamMembers)
      .where(
        and(eq(teamMembers.teamId, Number(id)), eq(teamMembers.userId, userId))
      );
    for (const r of rows) {
      await db.delete(teamMembers).where(eq(teamMembers.id, r.id));
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error(`[/api/teams/[id]/join DELETE] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
