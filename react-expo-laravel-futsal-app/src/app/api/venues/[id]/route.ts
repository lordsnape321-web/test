import { db } from "@/db";
import { venues, courts, bookings } from "@/db/schema";
import { validateVenueName, validateAddress, validatePhone, validateDescription, validateHoursRange, validatePaymentMethods, validateDepositPercent, firstError } from "@/lib/validation";
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
      body.depositPercent !== undefined ? validateDepositPercent(body.depositPercent) : null
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
