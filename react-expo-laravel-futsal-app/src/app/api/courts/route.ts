import { db } from "@/db";
import { courts, venues } from "@/db/schema";
import { validateCourtName, validateMoney, firstError } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const FORMATS = ["5v5", "6v6", "7v7", "8v8"];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const venueId = Number(body.venueId);
    const ownerId = Number(body.ownerId);
    const name = String(body.name ?? "").trim();
    if (!Number.isInteger(venueId) || venueId <= 0) {
      return Response.json({ error: "Pick a valid venue 📍" }, { status: 400 });
    }
    const err = firstError(
      validateCourtName(name),
      body.format && !FORMATS.includes(String(body.format)) ? "Pick a valid format (5v5–8v8) ⚽" : null,
      validateMoney(body.pricePerHour ?? 1500, { min: 100, max: 20000, label: "Price per hour" }),
      body.priceMorning !== undefined
        ? validateMoney(body.priceMorning, { min: 100, max: 20000, label: "Morning price" })
        : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });
    const venueRows = await db.select().from(venues).where(eq(venues.id, venueId));
    const venue = venueRows[0];
    if (!venue) return Response.json({ error: "Venue not found" }, { status: 404 });
    if (venue.ownerId && ownerId && venue.ownerId !== ownerId) {
      return Response.json({ error: "Only the venue owner can add courts" }, { status: 403 });
    }
    const price = Number(body.pricePerHour ?? 1500);
    const inserted = await db
      .insert(courts)
      .values({
        venueId,
        name,
        format: String(body.format ?? "5v5"),
        surface: String(body.surface ?? "Artificial Turf").slice(0, 60),
        pricePerHour: price,
        priceMorning: Number(body.priceMorning ?? Math.round(price * 0.75)),
        imageUrl: String(body.imageUrl ?? "").slice(0, 2000000),
        features: String(body.features ?? "Floodlights,Nets Provided,Match Balls").slice(0, 500),
      })
      .returning();
    return Response.json({ court: inserted[0] }, { status: 201 });
  } catch (e) {
    console.error(`[/api/courts POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
