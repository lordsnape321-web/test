import { db } from "@/db";
import { venues, courts } from "@/db/schema";
import { validateVenueName, validateAddress, validatePhone, validateDescription, validateHoursRange, validateSearch, validateMoney, validatePaymentMethods, validateDepositPercent, firstError } from "@/lib/validation";

export const dynamic = "force-dynamic";

const CITIES = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan"];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const city = searchParams.get("city") ?? "";

    const qErr = validateSearch(q, { max: 60 });
    if (qErr) return Response.json({ venues: [], error: qErr }, { status: 400 });
    if (city && city !== "All Cities" && !CITIES.includes(city))
      return Response.json({ venues: [], error: "Pick a valid city 📍" }, { status: 400 });

    let list = await db.select().from(venues);
    // A retired venue is out of the shop window — the owner's booking history
    // stays intact, it just stops showing up anywhere.
    const includeDeleted = searchParams.get("includeDeleted") === "1";
    if (!includeDeleted) list = list.filter((v) => !v.deletedAt);
    if (q) {
      const ql = q.toLowerCase();
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(ql) ||
          v.address.toLowerCase().includes(ql)
      );
    }
    if (city && city !== "All Cities") {
      list = list.filter((v) => v.city === city);
    }

    const allCourts = await db.select().from(courts);
    // A retired court is out of the count and out of the price, or a venue would
    // advertise a pitch nobody can book. Pass includeDeletedCourts=1 to see them.
    const includeDeletedCourts = searchParams.get("includeDeletedCourts") === "1";
    const liveCourts = includeDeletedCourts
      ? allCourts
      : allCourts.filter((c) => !c.deletedAt);
    const enriched = list.map((v) => {
      const vc = liveCourts.filter((c) => c.venueId === v.id);
      const minPrice =
        vc.length > 0 ? Math.min(...vc.map((c) => c.pricePerHour)) : 0;
      return { ...v, courts: vc, courtCount: vc.length, minPrice };
    });

    return Response.json({ venues: enriched });
  } catch (e) {
    console.error(`[/api/venues GET] failed:`, e);
    return Response.json({ venues: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    const address = String(body.address ?? "").trim();
    const city = String(body.city ?? "Kathmandu");
    const phone = String(body.phone ?? "").trim();
    const description = String(body.description ?? "").trim();
    const openingHour = body.openingHour ?? 6;
    const closingHour = body.closingHour ?? 22;

    const acceptedRaw = body.acceptedPayments
      ? String(body.acceptedPayments).split(",").map((s: string) => s.trim()).filter(Boolean)
      : ["eSewa", "Khalti", "Cash at Venue"];
    const depositPercent = body.depositPercent === undefined ? 30 : Number(body.depositPercent);
    const defaultExtraFee =
      body.defaultExtraFee === undefined ? 0 : Number(body.defaultExtraFee);
    const err = firstError(
      validateVenueName(name),
      validateAddress(address),
      !CITIES.includes(city) ? "Pick a valid city 📍" : null,
      phone ? validatePhone(phone, { required: false }) : null,
      validateDescription(description, { required: false, max: 1000 }),
      validateHoursRange(openingHour, closingHour),
      validatePaymentMethods(acceptedRaw),
      validateDepositPercent(depositPercent),
      validateMoney(defaultExtraFee, { min: 0, max: 20000, label: "Default extra fee" })
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    if (Array.isArray(body.courts)) {
      for (const c of body.courts) {
        const cErr = firstError(
          !c.name || String(c.name).trim().length < 2 ? "Each court needs a proper name ⚽" : null,
          validateMoney(c.pricePerHour ?? 1500, { min: 100, max: 20000, label: "Court price" })
        );
        if (cErr) return Response.json({ error: cErr }, { status: 400 });
      }
    }

    const inserted = await db
      .insert(venues)
      .values({
        name,
        address,
        city,
        phone,
        description,
        imageUrl: String(body.imageUrl ?? "").slice(0, 2000000),
        rating: 4.5,
        openingHour: Number(openingHour),
        closingHour: Number(closingHour),
        amenities: String(body.amenities ?? "Parking,Changing Room,Shower").slice(0, 500),
        acceptedPayments: acceptedRaw.join(","),
        depositPercent,
        defaultExtraFee,
        defaultExtraFeeNote: String(body.defaultExtraFeeNote ?? "").slice(0, 120),
        isFeatured: false,
        ownerId: body.ownerId ? Number(body.ownerId) : null,
      })
      .returning();
    if (Array.isArray(body.courts)) {
      for (const c of body.courts) {
        await db.insert(courts).values({
          venueId: inserted[0].id,
          name: String(c.name ?? "Court 1").slice(0, 60),
          format: String(c.format ?? "5v5").slice(0, 10),
          surface: String(c.surface ?? "Artificial Turf").slice(0, 60),
          pricePerHour: Number(c.pricePerHour ?? 1500),
          priceMorning: Number(c.priceMorning ?? 1200),
          imageUrl: String(c.imageUrl ?? "").slice(0, 2000000),
          features: String(c.features ?? "Floodlights").slice(0, 500),
        });
      }
    }
    return Response.json({ venue: inserted[0] }, { status: 201 });
  } catch (e) {
    console.error(`[/api/venues POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
