import { db, ensureCompetitionBookingColumns } from "@/db";
import { courts, venues, bookings } from "@/db/schema";
import { validateCourtName, validateMoney, firstError } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const FORMATS = ["5v5", "6v6", "7v7", "8v8"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCompetitionBookingColumns();
    const { id } = await params;
    if (!Number.isInteger(Number(id)) || Number(id) <= 0)
      return Response.json({ error: "Invalid court ⚽" }, { status: 400 });
    const body = await req.json();
    const err = firstError(
      body.name !== undefined ? validateCourtName(String(body.name)) : null,
      body.format !== undefined && !FORMATS.includes(String(body.format)) ? "Pick a valid format (5v5–8v8) ⚽" : null,
      body.surface !== undefined && String(body.surface).trim().length > 60 ? "Surface name too long (max 60)" : null,
      body.pricePerHour !== undefined ? validateMoney(body.pricePerHour, { min: 100, max: 20000, label: "Price per hour" }) : null,
      body.priceMorning !== undefined ? validateMoney(body.priceMorning, { min: 100, max: 20000, label: "Morning price" }) : null,
      body.features !== undefined && String(body.features).length > 500 ? "Facilities list too long (max 500)" : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });
    const patch: Partial<typeof courts.$inferInsert> = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.format !== undefined) patch.format = String(body.format);
    if (body.surface !== undefined) patch.surface = String(body.surface).slice(0, 60);
    if (body.pricePerHour !== undefined) patch.pricePerHour = Number(body.pricePerHour);
    if (body.priceMorning !== undefined) patch.priceMorning = Number(body.priceMorning);
    if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
    if (body.features !== undefined) patch.features = String(body.features).slice(0, 500);
    if (body.imageUrl !== undefined) patch.imageUrl = String(body.imageUrl).slice(0, 2000000);

    const updated = await db
      .update(courts)
      .set(patch)
      .where(eq(courts.id, Number(id)))
      .returning();
    if (updated.length === 0)
      return Response.json({ error: "Court not found" }, { status: 404 });
    return Response.json({ court: updated[0] });
  } catch (e) {
    console.error(`[/api/courts/[id] PATCH] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * Retire one court. Same shape as retiring a venue, one level down:
 * owner-only, soft, and refused while somebody still has a game booked on it —
 * a player who paid a deposit can't be left pointing at a pitch that vanished.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCompetitionBookingColumns();
    const { id } = await params;
    const courtId = Number(id);
    if (!Number.isInteger(courtId) || courtId <= 0)
      return Response.json({ error: "Invalid court ⚽" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const courtRows = await db.select().from(courts).where(eq(courts.id, courtId));
    const court = courtRows[0];
    if (!court) return Response.json({ error: "Court not found ⚽" }, { status: 404 });

    // Ownership lives on the venue, so go up a level to check who's asking.
    const venueRows = await db.select().from(venues).where(eq(venues.id, court.venueId));
    const venue = venueRows[0];
    const actor = Number(body.ownerId ?? body.userId ?? 0);
    if (!venue?.ownerId || actor !== venue.ownerId)
      return Response.json(
        { error: "Only the venue owner can delete this court 🔒" },
        { status: 403 }
      );

    if (court.deletedAt)
      return Response.json(
        { ok: true, alreadyDeleted: true, message: `${court.name} is already retired.` },
        { status: 200 }
      );

    const today = new Date().toISOString().slice(0, 10);
    const onCourt = await db.select().from(bookings).where(eq(bookings.courtId, courtId));
    const upcoming = onCourt.filter(
      (b) => b.status !== "cancelled" && b.status !== "rejected" && b.date >= today
    );
    if (upcoming.length > 0)
      return Response.json(
        {
          error: `${court.name} still has ${upcoming.length} booking${upcoming.length === 1 ? "" : "s"} to come — cancel or play them before retiring this court, so nobody turns up to a pitch that's gone 📅`,
          reason: "upcoming_bookings",
          upcoming: upcoming.length,
        },
        { status: 409 }
      );

    const updated = await db
      .update(courts)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(courts.id, courtId))
      .returning();

    return Response.json({
      ok: true,
      court: updated[0],
      message: `${court.name} is retired — it's off the booking page and out of ${venue.name}'s court count. Past bookings and payments are untouched 🪦`,
    });
  } catch (e) {
    console.error(`[/api/courts/[id] DELETE] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
