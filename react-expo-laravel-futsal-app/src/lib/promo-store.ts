import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookings, promos, venues } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  PROMO_COUNTING_STATUSES,
  prettyPromoDate,
  promoExpiryLabel,
  promoState,
  promoStateBadge,
  promoSummary,
  promoWindow,
  type PromoLike,
} from "./promos";

export type PromoRow = typeof promos.$inferSelect;

/**
 * Redemptions are counted from bookings, not a counter column — so a cancelled
 * or declined booking automatically gives the code back. Nothing to keep in sync.
 */
export type PromoUsage = {
  used: number;
  discountGiven: number;
  byUser: Map<number, number>;
};

export async function promoUsage(promoIds: number[]): Promise<Map<number, PromoUsage>> {
  await ensureCompetitionBookingColumns();
  const out = new Map<number, PromoUsage>();
  for (const id of promoIds) out.set(id, { used: 0, discountGiven: 0, byUser: new Map() });
  if (promoIds.length === 0) return out;
  const rows = await db.select().from(bookings).where(inArray(bookings.promoId, promoIds));
  for (const b of rows) {
    if (!b.promoId || !PROMO_COUNTING_STATUSES.includes(b.status)) continue;
    const u = out.get(b.promoId) ?? { used: 0, discountGiven: 0, byUser: new Map<number, number>() };
    u.used += 1;
    u.discountGiven += b.discountAmount ?? 0;
    u.byUser.set(b.userId, (u.byUser.get(b.userId) ?? 0) + 1);
    out.set(b.promoId, u);
  }
  return out;
}

export async function findPromoByCode(venueId: number, code: string): Promise<PromoRow | null> {
  const rows = await db.select().from(promos).where(eq(promos.venueId, venueId));
  return rows.find((p) => p.code === code) ?? null;
}

/** Slim payload players are allowed to see (no limits they could game). */
export function publicPromo(p: PromoRow) {
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    discountType: p.discountType,
    discountValue: p.discountValue,
    maxDiscount: p.maxDiscount,
    minBookingAmount: p.minBookingAmount,
    startsAt: p.startsAt,
    expiresAt: p.expiresAt,
    summary: promoSummary(p),
    expiryLabel: promoExpiryLabel(p),
    expiresOn: prettyPromoDate(p.expiresAt),
  };
}

/** Owner payload: everything plus live status + how much it has been used. */
export function ownerPromo(p: PromoRow, usage?: PromoUsage) {
  const used = usage?.used ?? 0;
  const state = promoState(p);
  const badge = promoStateBadge(state);
  const limit = Math.max(0, Number(p.usageLimit) || 0);
  return {
    ...p,
    summary: promoSummary(p),
    expiryLabel: promoExpiryLabel(p),
    expiresOn: prettyPromoDate(p.expiresAt),
    startsOn: p.startsAt ? prettyPromoDate(p.startsAt) : "",
    state,
    stateLabel: badge.label,
    stateEmoji: badge.emoji,
    live: state === "live",
    usedCount: used,
    remaining: limit > 0 ? Math.max(0, limit - used) : null,
    discountGiven: usage?.discountGiven ?? 0,
  };
}

/** Venue + owner check shared by create/update/delete. */
export async function venueForOwner(venueId: number, ownerId: number) {
  const rows = await db.select().from(venues).where(eq(venues.id, venueId));
  const venue = rows[0];
  if (!venue) return { venue: null, error: "Venue not found 📍" as const };
  if (venue.ownerId && ownerId && venue.ownerId !== ownerId)
    return { venue, error: "Only the venue owner can manage its promo codes 🔒" as const };
  return { venue, error: null };
}

/** Is this code still usable, ignoring usage counts? (for list badges) */
export function promoIsLive(p: PromoLike): boolean {
  return p.isActive !== false && promoWindow(p) === "live";
}
