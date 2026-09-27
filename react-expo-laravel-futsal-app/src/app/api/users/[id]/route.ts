import { db, ensureCompetitionBookingColumns } from "@/db";
import { users, bookings } from "@/db/schema";
import { safeUser } from "@/lib/auth";
import { playerRating } from "@/lib/loyalty";
import { validateName, validatePhone, normalizePhone, validateCity, validateAvatarUrl, firstError } from "@/lib/validation";
import { eq, and, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

const LEVELS = ["Beginner", "Intermediate", "Advanced", "—"];
const POSITIONS = ["Striker", "Midfielder", "Winger", "Defender", "Goalkeeper", "Pivot", "All-rounder", "Owner"];
const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#4d7c0f", "#f59e0b"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCompetitionBookingColumns();
    const { id } = await params;
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Invalid user" }, { status: 400 });
    const rows = await db.select().from(users).where(eq(users.id, userId));
    if (rows.length === 0) return Response.json({ error: "User not found" }, { status: 404 });
    const history = await db.select().from(bookings).where(eq(bookings.userId, userId));
    const tScore = ((rows[0] as { trustScore?: number }).trustScore ?? 100) as number;
    const stats = playerRating(
      history.map((r) => ({ status: r.status, createdAt: r.createdAt })),
      new Date(),
      tScore
    );
    return Response.json({ user: safeUser(rows[0]), stats });
  } catch (e) {
    console.error(`[/api/users/[id] GET] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCompetitionBookingColumns();
    const { id } = await params;
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Invalid user" }, { status: 400 });
    const body = await req.json();

    const current = await db.select().from(users).where(eq(users.id, userId));
    if (current.length === 0) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const patch: Partial<typeof users.$inferInsert> = {};

    if (body.name !== undefined) {
      const err = validateName(String(body.name));
      if (err) return Response.json({ error: err }, { status: 400 });
      patch.name = String(body.name).trim();
    }
    if (body.phone !== undefined) {
      const phone = normalizePhone(String(body.phone));
      const err = validatePhone(phone, { required: true });
      if (err) return Response.json({ error: err }, { status: 400 });
      const taken = await db
        .select()
        .from(users)
        .where(and(eq(users.phone, phone), ne(users.id, userId)));
      if (taken.length > 0) {
        return Response.json(
          { error: "This phone number is already used by another account. 📱" },
          { status: 409 }
        );
      }
      patch.phone = phone;
    }
    if (body.avatarColor !== undefined) {
      const c = String(body.avatarColor);
      if (!COLORS.includes(c) && !/^#[0-9a-fA-F]{6}$/.test(c))
        return Response.json({ error: "Pick a valid avatar colour 🎨" }, { status: 400 });
      patch.avatarColor = c;
    }
    if (body.level !== undefined) {
      if (!LEVELS.includes(String(body.level)))
        return Response.json({ error: "Pick a valid level 🌱⚡🔥" }, { status: 400 });
      patch.level = String(body.level);
    }
    if (body.position !== undefined) {
      if (!POSITIONS.includes(String(body.position)))
        return Response.json({ error: "Pick a valid position ⚽" }, { status: 400 });
      patch.position = String(body.position);
    }
    if (body.avatarUrl !== undefined) {
      const err = validateAvatarUrl(String(body.avatarUrl));
      if (err) return Response.json({ error: err }, { status: 400 });
      patch.avatarUrl = String(body.avatarUrl).trim().slice(0, 2000000);
    }
    if (body.defaultCity !== undefined) {
      const err = validateCity(String(body.defaultCity), "Home city");
      if (err) return Response.json({ error: err }, { status: 400 });
      patch.defaultCity = String(body.defaultCity).trim();
    }
    void firstError;

    const updated = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning();

    return Response.json({ user: safeUser(updated[0]) });
  } catch (e) {
    console.error(`[/api/users/[id] PATCH] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
