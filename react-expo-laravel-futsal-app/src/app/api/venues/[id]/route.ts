import { db } from "@/db";
import { venues, courts, bookings } from "@/db/schema";
import { validateVenueName, validateAddress, validatePhone, validateDescription, validateHoursRange, validatePaymentMethods, validateDepositPercent, validateMoney, firstError } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const CITIES = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const venueId = Number(id);
    if (!Number.isInteger(venueId) || venueId <= 0)
      return Response.json({ error: "Invalid venue" }, { status: 400 });
    const found = await db.select().from(venues).where(eq(venues.id, venueId));
    if (found.length === 0)
      return Response.json({ error: "Not found" }, { status: 404 });
    const venueCourts = await db
      .select()
      .from(courts)
      .where(eq(courts.venueId, venueId));
    const venueBookings = await db.select().from(bookings);
    const count = venueBookings.filter((b) =>
      venueCourts.some((c) => c.id === b.courtId)
    ).length;
    return Response.json({
      venue: { ...found[0], courts: venueCourts, totalBookings: count },
    });
  } catch (e) {
    console.error(`[/api/venues/[id] GET] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const venueId = Number(id);
    if (!Number.isInteger(venueId) || venueId <= 0)
      return Response.json({ error: "Invalid venue" }, { status: 400 });
    const body = await req.json();

    const rows = await db.select().from(venues).where(eq(venues.id, venueId));
    const venue = rows[0];
    if (!venue) return Response.json({ error: "Not found" }, { status: 404 });

    if (
      venue.ownerId &&
      body.ownerId &&
      Number(body.ownerId) !== venue.ownerId
    ) {
      return Response.json(
        { error: "Only the venue owner can edit this venue" },
        { status: 403 }
      );
    }

    const err = firstError(
      body.name !== undefined ? validateVenueName(String(body.name)) : null,
      body.address !== undefined ? validateAddress(String(body.address)) : null,
      body.city !== undefined && !CITIES.includes(String(body.city)) ? "Pick a valid city 📍" : null,
      body.phone !== undefined && String(body.phone).trim() ? validatePhone(String(body.phone), { required: false }) : null,
      body.description !== undefined ? validateDescription(String(body.description), { required: false, max: 1000 }) : null,
      body.openingHour !== undefined || body.closingHour !== undefined
        ? validateHoursRange(body.openingHour ?? venue.openingHour, body.closingHour ?? venue.closingHour)
        : null,
      body.amenities !== undefined && String(body.amenities).length > 500 ? "Facilities list too long (max 500) ✨" : null,
      body.acceptedPayments !== undefined
        ? validatePaymentMethods(String(body.acceptedPayments).split(",").map((s: string) => s.trim()).filter(Boolean))
        : null,
      body.depositPercent !== undefined ? validateDepositPercent(body.depositPercent) : null,
      body.defaultExtraFee !== undefined
        ? validateMoney(body.defaultExtraFee, { min: 0, max: 20000, label: "Default extra fee" })
        : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    const patch: Partial<typeof venues.$inferInsert> = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.address !== undefined) patch.address = String(body.address).trim();
    if (body.city !== undefined) patch.city = String(body.city);
    if (body.phone !== undefined) patch.phone = String(body.phone).trim();
    if (body.description !== undefined)
      patch.description = String(body.description).trim().slice(0, 1000);
    if (body.openingHour !== undefined)
      patch.openingHour = Number(body.openingHour);
    if (body.closingHour !== undefined)
      patch.closingHour = Number(body.closingHour);
    if (body.amenities !== undefined) patch.amenities = String(body.amenities).slice(0, 500);
    if (body.acceptedPayments !== undefined) {
      const clean = String(body.acceptedPayments).split(",").map((s: string) => s.trim()).filter(Boolean);
      patch.acceptedPayments = clean.join(",");
    }
    if (body.depositPercent !== undefined) patch.depositPercent = Number(body.depositPercent);
    // What this venue usually adds on top of the court fee — prefills the
    // extra-charge line on the payment desk.
    if (body.defaultExtraFee !== undefined) patch.defaultExtraFee = Number(body.defaultExtraFee);
    if (body.defaultExtraFeeNote !== undefined)
      patch.defaultExtraFeeNote = String(body.defaultExtraFeeNote).slice(0, 120);
    if (body.imageUrl !== undefined) patch.imageUrl = String(body.imageUrl).slice(0, 2000000);

    const updated = await db
      .update(venues)
      .set(patch)
      .where(eq(venues.id, venueId))
      .returning();
    return Response.json({ venue: updated[0] });
  } catch (e) {
    console.error(`[/api/venues/[id] PATCH] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/venues/[id] — retire the venue 🪦
 *
 * The owner's own call, and a soft one. A venue has bookings, payments, reviews
 * and leagues hanging off it, so the row stays and `deletedAt` is stamped:
 * the venue leaves every listing and its courts stop taking bookings, but
 * nobody's history — least of all the owner's money — is erased.
 *
 * It refuses while players still have a game to come. Someone who paid a
 * deposit for Saturday shouldn't find the ground has quietly ceased to exist;
 * cancel or play those first.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const venueId = Number(id);
    if (!Number.isInteger(venueId) || venueId <= 0)
      return Response.json({ error: "Invalid venue" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const rows = await db.select().from(venues).where(eq(venues.id, venueId));
    const venue = rows[0];
    if (!venue) return Response.json({ error: "Not found" }, { status: 404 });

    const actor = Number(body.ownerId ?? body.userId ?? 0);
    if (!venue.ownerId || actor !== venue.ownerId)
      return Response.json(
        { error: "Only the venue owner can delete this venue 🔒" },
        { status: 403 }
      );
    if (venue.deletedAt)
      return Response.json(
        { ok: true, alreadyDeleted: true, message: `${venue.name} is already retired.` },
        { status: 200 }
      );

    const today = new Date().toISOString().slice(0, 10);
    const venueCourts = await db.select().from(courts).where(eq(courts.venueId, venueId));
    const courtIds = venueCourts.map((c) => c.id);
    const upcoming = courtIds.length
      ? (await db.select().from(bookings)).filter(
          (b) =>
            courtIds.includes(b.courtId) &&
            b.status !== "cancelled" &&
            b.status !== "rejected" &&
            b.date >= today
        )
      : [];
    if (upcoming.length > 0)
      return Response.json(
        {
          error: `${venue.name} still has ${upcoming.length} booking${upcoming.length === 1 ? "" : "s"} to come — cancel or play them before retiring the venue, so nobody turns up to a ground that's gone 📅`,
          reason: "upcoming_bookings",
          upcoming: upcoming.length,
        },
        { status: 409 }
      );

    // Courts go dark with the venue, so nothing new can be booked against it.
    for (const courtId of courtIds) {
      await db.update(courts).set({ isActive: false }).where(eq(courts.id, courtId));
    }
    const updated = await db
      .update(venues)
      .set({ deletedAt: new Date() })
      .where(eq(venues.id, venueId))
      .returning();

    return Response.json({
      ok: true,
      venue: updated[0],
      courtsClosed: courtIds.length,
      message: `${venue.name} is retired — it's out of every listing and its ${courtIds.length} court${courtIds.length === 1 ? "" : "s"} stopped taking bookings. Past bookings and payments are untouched 🪦`,
    });
  } catch (e) {
    console.error(`[/api/venues/[id] DELETE] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
