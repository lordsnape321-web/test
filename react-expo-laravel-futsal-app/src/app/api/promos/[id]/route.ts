import { db } from "@/db";
import { promos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { normalizePromoCode, type PromoDiscountType } from "@/lib/promos";
import { ownerPromo, promoUsage, venueForOwner } from "@/lib/promo-store";
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

async function loadPromo(id: number) {
  const rows = await db.select().from(promos).where(eq(promos.id, id));
  return rows[0] ?? null;
}

/** GET /api/promos/12?ownerId=7 — one promo with its redemption stats. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!Number.isInteger(Number(id)) || Number(id) <= 0)
      return Response.json({ error: "Invalid promo 🎟️" }, { status: 400 });
    const promo = await loadPromo(Number(id));
    if (!promo) return Response.json({ error: "Promo code not found 🎟️" }, { status: 404 });

    const ownerId = Number(new URL(req.url).searchParams.get("ownerId") ?? 0);
    const { error } = await venueForOwner(promo.venueId, ownerId);
    if (error) return Response.json({ error }, { status: ownerId ? 403 : 400 });

    const usage = await promoUsage([promo.id]);
    return Response.json({ promo: ownerPromo(promo, usage.get(promo.id)) });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/** PATCH /api/promos/12 — owner edits the discount, dates, limits, or pauses it. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!Number.isInteger(Number(id)) || Number(id) <= 0)
      return Response.json({ error: "Invalid promo 🎟️" }, { status: 400 });
    const body = await req.json();
    const promo = await loadPromo(Number(id));
    if (!promo) return Response.json({ error: "Promo code not found 🎟️" }, { status: 404 });

    const ownerId = Number(body.ownerId ?? 0);
    if (!Number.isInteger(ownerId) || ownerId <= 0)
      return Response.json({ error: "Login as the venue owner to change promos 🔒" }, { status: 403 });
    const { venue, error } = await venueForOwner(promo.venueId, ownerId);
    if (error) return Response.json({ error }, { status: venue ? 403 : 404 });

    const discountType: PromoDiscountType =
      body.discountType !== undefined
        ? body.discountType === "flat"
          ? "flat"
          : "percent"
        : (promo.discountType as PromoDiscountType);
    const discountValue =
      body.discountValue !== undefined ? Number(body.discountValue) : promo.discountValue;
    const nextStarts =
      body.startsAt !== undefined ? String(body.startsAt ?? "").trim() || null : promo.startsAt;
    const nextExpires =
      body.expiresAt !== undefined ? String(body.expiresAt ?? "").trim() : promo.expiresAt;

    const err = firstError(
      body.code !== undefined ? validatePromoCode(body.code) : null,
      body.title !== undefined && String(body.title).trim() ? validatePromoTitle(body.title) : null,
      body.discountType !== undefined ? validateDiscountType(body.discountType) : null,
      body.discountValue !== undefined || body.discountType !== undefined
        ? validateDiscountValue(discountValue, discountType)
        : null,
      body.maxDiscount !== undefined ? validateMaxDiscount(body.maxDiscount) : null,
      body.minBookingAmount !== undefined ? validateMinBookingAmount(body.minBookingAmount) : null,
      body.usageLimit !== undefined ? validateUsageLimit(body.usageLimit, "Total redemption limit") : null,
      body.perUserLimit !== undefined ? validateUsageLimit(body.perUserLimit, "Per-player limit") : null,
      body.startsAt !== undefined || body.expiresAt !== undefined
        ? validatePromoWindow(nextStarts, nextExpires)
        : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    const patch: Partial<typeof promos.$inferInsert> = {};
    if (body.code !== undefined) {
      const code = normalizePromoCode(body.code);
      if (code !== promo.code) {
        const siblings = await db.select().from(promos).where(eq(promos.venueId, promo.venueId));
        if (siblings.some((p) => p.id !== promo.id && p.code === code))
          return Response.json(
            { error: `"${code}" is already running at ${venue?.name ?? "this venue"} — pick another 🎟️` },
            { status: 409 }
          );
        patch.code = code;
      }
    }
    if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 60);
    if (body.discountType !== undefined) patch.discountType = discountType;
    if (body.discountValue !== undefined) patch.discountValue = Math.round(discountValue);
    if (body.maxDiscount !== undefined)
      patch.maxDiscount = discountType === "flat" ? 0 : Math.round(Number(body.maxDiscount) || 0);
    if (body.minBookingAmount !== undefined)
      patch.minBookingAmount = Math.round(Number(body.minBookingAmount) || 0);
    if (body.startsAt !== undefined) patch.startsAt = nextStarts;
    if (body.expiresAt !== undefined) patch.expiresAt = nextExpires;
    if (body.usageLimit !== undefined) patch.usageLimit = Math.round(Number(body.usageLimit) || 0);
    if (body.perUserLimit !== undefined)
      patch.perUserLimit = Math.round(Number(body.perUserLimit) || 0);
    if (body.isPublic !== undefined) patch.isPublic = Boolean(body.isPublic);
    if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);

    const updated = await db
      .update(promos)
      .set(patch)
      .where(eq(promos.id, promo.id))
      .returning();
    const usage = await promoUsage([promo.id]);
    return Response.json({ promo: ownerPromo(updated[0], usage.get(promo.id)) });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/promos/12 — remove a code. Redeemed ones are paused instead. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!Number.isInteger(Number(id)) || Number(id) <= 0)
      return Response.json({ error: "Invalid promo 🎟️" }, { status: 400 });
    const promo = await loadPromo(Number(id));
    if (!promo) return Response.json({ error: "Promo code not found 🎟️" }, { status: 404 });

    const ownerId = Number(new URL(req.url).searchParams.get("ownerId") ?? 0);
    if (!Number.isInteger(ownerId) || ownerId <= 0)
      return Response.json({ error: "Login as the venue owner to delete promos 🔒" }, { status: 403 });
    const { venue, error } = await venueForOwner(promo.venueId, ownerId);
    if (error) return Response.json({ error }, { status: venue ? 403 : 404 });

    const usage = await promoUsage([promo.id]);
    const used = usage.get(promo.id)?.used ?? 0;
    if (used > 0) {
      await db.update(promos).set({ isActive: false }).where(eq(promos.id, promo.id));
      return Response.json(
        {
          ok: false,
          paused: true,
          error: `"${promo.code}" was used on ${used} booking${used === 1 ? "" : "s"} — deleting it would erase that history, so it's paused instead ⏸️`,
        },
        { status: 409 }
      );
    }

    await db.delete(promos).where(eq(promos.id, promo.id));
    return Response.json({ ok: true, deletedId: promo.id });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
