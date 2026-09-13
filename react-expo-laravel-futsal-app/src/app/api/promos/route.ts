import { db } from "@/db";
import { promos, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  checkPromo,
  normalizePromoCode,
  promoWindow,
  type PromoDiscountType,
} from "@/lib/promos";
import { ownerPromo, promoUsage, publicPromo, venueForOwner } from "@/lib/promo-store";
import {
  firstError,
  validateDiscountType,
  validateDiscountValue,
  validateMaxDiscount,
  validateMinBookingAmount,
  validatePromoCode,
  validatePromoTitle,
  validatePromoWindow,
  validateUsageLimit,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/promos?ownerId=7                      -> every promo the owner runs (+ usage)
 * GET /api/promos?venueId=1                      -> codes advertised at that venue right now
 * GET /api/promos?venueId=1&code=SAVE10&amount=3000&userId=2
 *                                                -> "can I use this?" + the discount preview
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ownerId = searchParams.get("ownerId");
    const venueId = searchParams.get("venueId");
    const code = normalizePromoCode(searchParams.get("code") ?? "");
    const amountRaw = searchParams.get("amount");

    /* ------------------------------ owner list ----------------------------- */
    if (ownerId) {
      if (!Number.isInteger(Number(ownerId)) || Number(ownerId) <= 0)
        return Response.json({ promos: [], error: "Invalid owner 🔒" }, { status: 400 });
      const allVenues = await db.select().from(venues);
      const mine = new Set(
        allVenues.filter((v) => v.ownerId === Number(ownerId)).map((v) => v.id)
      );
      if (mine.size === 0) return Response.json({ promos: [], venueNames: {} });
      const rows = await db.select().from(promos);
      const list = rows.filter((p) => mine.has(p.venueId));
      const usage = await promoUsage(list.map((p) => p.id));
      const venueNames = Object.fromEntries(
        allVenues.filter((v) => mine.has(v.id)).map((v) => [v.id, v.name])
      );
      return Response.json({
        promos: list.map((p) => ownerPromo(p, usage.get(p.id))).sort((a, b) => b.id - a.id),
        venueNames,
      });
    }

    if (!venueId) return Response.json({ promos: [], error: "Pass venueId or ownerId 📍" }, { status: 400 });
    if (!Number.isInteger(Number(venueId)) || Number(venueId) <= 0)
      return Response.json({ promos: [], error: "Invalid venue 📍" }, { status: 400 });

    const venueRows = await db.select().from(venues).where(eq(venues.id, Number(venueId)));
    const venue = venueRows[0];
    if (!venue) return Response.json({ promos: [], error: "Venue not found 📍" }, { status: 404 });
    const all = await db.select().from(promos).where(eq(promos.venueId, Number(venueId)));

    /* ----------------------------- code check ------------------------------ */
    if (code) {
      const amount = Number(amountRaw ?? 0);
      if (!Number.isFinite(amount) || amount < 0 || amount > 10000000)
        return Response.json({ valid: false, error: "Invalid booking amount 💰", reason: "bad_amount" }, { status: 400 });
      const userId = Number(searchParams.get("userId") ?? 0) || 0;
      if (searchParams.get("userId") && (!Number.isInteger(userId) || userId <= 0))
        return Response.json({ valid: false, error: "Invalid player 🔒", reason: "bad_user" }, { status: 400 });

      const found = all.find((p) => p.code === code) ?? null;
      const usage = found ? await promoUsage([found.id]) : new Map();
      const u = found ? usage.get(found.id) : undefined;
      const check = checkPromo({
        promo: found,
        code,
        venueName: venue.name,
        subtotal: Math.round(amount),
        usedCount: u?.used ?? 0,
        userUsedCount: userId ? (u?.byUser.get(userId) ?? 0) : 0,
      });
      if (!check.ok || !found)
        return Response.json(
          {
            valid: false,
            error: check.ok ? "That code isn't available right now 🎟️" : check.error,
            reason: check.ok ? "unavailable" : check.reason,
            promo: found ? publicPromo(found) : null,
          },
          { status: 400 }
        );
      return Response.json({
        valid: true,
        promo: publicPromo(found),
        subtotal: Math.round(amount),
        discount: check.discount,
        capped: check.capped,
        payable: check.payable,
        message: check.message,
      });
    }

    /* --------------------------- public discovery -------------------------- */
    // Only advertised, in-window codes — hidden ones stay redeemable but unlisted.
    const live = all
      .filter((p) => p.isActive && p.isPublic && promoWindow(p) === "live")
      .sort((a, b) => b.discountValue - a.discountValue)
      .map(publicPromo);
    return Response.json({ promos: live, venueId: Number(venueId), venueName: venue.name });
  } catch (e) {
    return Response.json({ promos: [], error: String(e) }, { status: 500 });
  }
}

/** POST /api/promos — a venue owner creates a code with an expiry date. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const venueId = Number(body.venueId);
    const ownerId = Number(body.ownerId);
    const code = normalizePromoCode(body.code);
    const title = String(body.title ?? "").trim();
    const discountType: PromoDiscountType = body.discountType === "flat" ? "flat" : "percent";
    const discountValue = Number(body.discountValue ?? 0);
    const maxDiscount = discountType === "percent" ? Number(body.maxDiscount ?? 0) || 0 : 0;
    const minBookingAmount = Number(body.minBookingAmount ?? 0) || 0;
    const startsAt = String(body.startsAt ?? "").trim() || null;
    const expiresAt = String(body.expiresAt ?? "").trim();
    const usageLimit = Number(body.usageLimit ?? 0) || 0;
    const perUserLimit = body.perUserLimit === undefined ? 1 : Number(body.perUserLimit) || 0;

    const err = firstError(
      !Number.isInteger(venueId) || venueId <= 0 ? "Pick a valid venue 📍" : null,
      !Number.isInteger(ownerId) || ownerId <= 0 ? "Login to create promo codes 🔒" : null,
      validatePromoCode(code),
      title ? validatePromoTitle(title) : null,
      validateDiscountType(discountType),
      validateDiscountValue(discountValue, discountType),
      validateMaxDiscount(maxDiscount),
      validateMinBookingAmount(minBookingAmount),
      validateUsageLimit(usageLimit, "Total redemption limit"),
      validateUsageLimit(perUserLimit, "Per-player limit"),
      validatePromoWindow(startsAt, expiresAt)
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    const { venue, error: venueErr } = await venueForOwner(venueId, ownerId);
    if (venueErr) return Response.json({ error: venueErr }, { status: venue ? 403 : 404 });

    const existing = await db.select().from(promos).where(eq(promos.venueId, venueId));
    if (existing.some((p) => p.code === code))
      return Response.json(
        { error: `"${code}" is already running at ${venue?.name ?? "this venue"} — pick another code 🎟️` },
        { status: 409 }
      );

    const inserted = await db
      .insert(promos)
      .values({
        venueId,
        code,
        title: title.slice(0, 60),
        discountType,
        discountValue: Math.round(discountValue),
        maxDiscount: Math.round(maxDiscount),
        minBookingAmount: Math.round(minBookingAmount),
        startsAt,
        expiresAt,
        usageLimit: Math.round(usageLimit),
        perUserLimit: Math.round(perUserLimit),
        isPublic: body.isPublic === undefined ? true : Boolean(body.isPublic),
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      })
      .returning();

    return Response.json({ promo: ownerPromo(inserted[0]) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
