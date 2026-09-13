import { formatNPR } from "./futsal";

export const PROMO_DISCOUNT_TYPES = ["percent", "flat"];
export type PromoDiscountType = "percent" | "flat";

export const PROMO_CODE_MIN = 3;
export const PROMO_CODE_MAX = 24;
export const PROMO_MAX_PERCENT = 100;
export const PROMO_MAX_FLAT = 100000;
export const PROMO_MAX_CAP = 100000;
export const PROMO_MAX_DAYS_AHEAD = 365;
/** A booking status that still counts as a redemption (cancelled/rejected don't). */
export const PROMO_COUNTING_STATUSES = ["pending", "confirmed", "completed"];

export type PromoLike = {
  id?: number;
  code: string;
  title?: string | null;
  discountType: string;
  discountValue: number;
  maxDiscount?: number | null;
  minBookingAmount?: number | null;
  startsAt?: string | null;
  expiresAt: string;
  usageLimit?: number | null;
  perUserLimit?: number | null;
  isPublic?: boolean | null;
  isActive?: boolean | null;
};

/** Codes are stored + compared uppercase, no spaces: "save 10" -> "SAVE10". */
export function normalizePromoCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, PROMO_CODE_MAX);
}

/** Local YYYY-MM-DD (same shape as bookings.date, so no timezone surprises). */
export function promoDateISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function isValidDateISO(raw: unknown): boolean {
  const t = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const d = new Date(`${t}T00:00:00`);
  return !Number.isNaN(d.getTime()) && promoDateISO(d) === t;
}

/** Whole calendar days from today until `iso`. Negative = already past. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  if (!isValidDateISO(iso)) return 0;
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date(promoDateISO(now) + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** Where the promo sits in its life: not started, running, or past its expiry. */
export function promoWindow(promo: PromoLike, now: Date = new Date()): "upcoming" | "live" | "expired" {
  const today = promoDateISO(now);
  if (promo.expiresAt && today > promo.expiresAt) return "expired";
  if (promo.startsAt && today < promo.startsAt) return "upcoming";
  return "live";
}

export type PromoState = "live" | "upcoming" | "expired" | "paused";

/** Owner-facing state. `paused` = switched off by the owner. */
export function promoState(promo: PromoLike, now: Date = new Date()): PromoState {
  if (promo.isActive === false) return "paused";
  return promoWindow(promo, now);
}

export function promoStateBadge(state: PromoState): { label: string; emoji: string } {
  switch (state) {
    case "live":
      return { label: "Live", emoji: "🟢" };
    case "upcoming":
      return { label: "Starts later", emoji: "⏳" };
    case "expired":
      return { label: "Expired", emoji: "⌛" };
    default:
      return { label: "Paused", emoji: "⏸️" };
  }
}

/** Is this redeemable right now? Expiry date counts as the last valid day. */
export function isPromoLive(promo: PromoLike, now: Date = new Date()): boolean {
  return promo.isActive !== false && promoWindow(promo, now) === "live";
}

export function promoExpiryLabel(promo: PromoLike, now: Date = new Date()): string {
  const left = daysUntil(promo.expiresAt, now);
  if (left < 0) return `Expired ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago`;
  if (left === 0) return "Last day today ⚡";
  if (left === 1) return "Ends tomorrow";
  if (left <= 30) return `${left} days left`;
  return `Until ${prettyPromoDate(promo.expiresAt)}`;
}

export function prettyPromoDate(iso: string): string {
  if (!isValidDateISO(iso)) return String(iso ?? "");
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** "15% off" / "15% off up to Rs. 500" / "Rs. 300 off". */
export function promoSummary(promo: PromoLike): string {
  const value = Math.max(0, Math.round(Number(promo.discountValue) || 0));
  if (promo.discountType === "flat") return `${formatNPR(value)} off`;
  const cap = Math.max(0, Math.round(Number(promo.maxDiscount) || 0));
  return cap > 0 ? `${value}% off up to ${formatNPR(cap)}` : `${value}% off`;
}

export type PromoDiscount = { amount: number; capped: boolean; subtotal: number; payable: number };

/**
 * How much does this promo take off `subtotal`?
 * Percent respects the optional cap; flat is clamped to the bill. Never negative,
 * never more than the bill — a promo can make a game free but not pay the player.
 */
export function promoDiscountFor(promo: PromoLike, subtotal: number): PromoDiscount {
  const base = Math.max(0, Math.round(Number(subtotal) || 0));
  const value = Math.max(0, Math.round(Number(promo.discountValue) || 0));
  let raw = 0;
  let capped = false;
  if (promo.discountType === "flat") {
    raw = value;
  } else {
    raw = Math.round((base * value) / 100);
    const cap = Math.max(0, Math.round(Number(promo.maxDiscount) || 0));
    if (cap > 0 && raw > cap) {
      raw = cap;
      capped = true;
    }
  }
  const amount = Math.max(0, Math.min(base, raw));
  return { amount, capped, subtotal: base, payable: base - amount };
}

export type PromoCheckOk = {
  ok: true;
  promo: PromoLike;
  discount: number;
  capped: boolean;
  payable: number;
  message: string;
};
export type PromoCheckFail = { ok: false; error: string; reason: string };
export type PromoCheck = PromoCheckOk | PromoCheckFail;

/**
 * Everything that decides whether a player may use a code on this bill:
 * owner switched it on, inside its start/expiry window, minimum spend met,
 * venue-wide redemption limit and this player's own limit not exhausted.
 */
export function checkPromo(opts: {
  promo: PromoLike | null;
  code: string;
  venueName?: string;
  subtotal: number;
  usedCount?: number;
  userUsedCount?: number;
  now?: Date;
}): PromoCheck {
  const now = opts.now ?? new Date();
  const code = normalizePromoCode(opts.code);
  const fail = (error: string, reason: string): PromoCheckFail => ({ ok: false, error, reason });

  if (!code) return fail("Type a promo code first 🎟️", "empty");
  const promo = opts.promo;
  if (!promo) return fail(`"${code}" isn't a code at ${opts.venueName ?? "this futsal"} — check the spelling 🎟️`, "not_found");

  const window = promoWindow(promo, now);
  if (promo.isActive === false)
    return fail(`"${promo.code}" has been paused by the venue 😴 — try another code`, "paused");
  if (window === "expired")
    return fail(`"${promo.code}" expired on ${prettyPromoDate(promo.expiresAt)} ⌛ — this one's gone`, "expired");
  if (window === "upcoming")
    return fail(`"${promo.code}" starts on ${prettyPromoDate(String(promo.startsAt))} ⏳ — come back then!`, "upcoming");

  const subtotal = Math.max(0, Math.round(Number(opts.subtotal) || 0));
  const minSpend = Math.max(0, Math.round(Number(promo.minBookingAmount) || 0));
  if (subtotal <= 0) return fail("There's nothing left to discount on this booking 🎁", "nothing_to_discount");
  if (minSpend > 0 && subtotal < minSpend)
    return fail(
      `"${promo.code}" needs a booking of at least ${formatNPR(minSpend)} — yours is ${formatNPR(subtotal)} 💰`,
      "min_spend"
    );

  const used = Math.max(0, Math.round(Number(opts.usedCount) || 0));
  const limit = Math.max(0, Math.round(Number(promo.usageLimit) || 0));
  if (limit > 0 && used >= limit)
    return fail(`"${promo.code}" is fully redeemed (${used}/${limit}) 🏁 — quick off the mark next time!`, "limit_reached");

  const userUsed = Math.max(0, Math.round(Number(opts.userUsedCount) || 0));
  const perUser = Math.max(0, Math.round(Number(promo.perUserLimit) || 0));
  if (perUser > 0 && userUsed >= perUser)
    return fail(
      perUser === 1
        ? `You've already used "${promo.code}" on a live booking 🙌 — one per player, sorry!`
        : `You've used "${promo.code}" ${userUsed} times already (limit ${perUser}) 🙌`,
      "per_user_limit"
    );

  const d = promoDiscountFor(promo, subtotal);
  if (d.amount <= 0) return fail(`"${promo.code}" doesn't take anything off this bill 🙂`, "no_discount");

  return {
    ok: true,
    promo,
    discount: d.amount,
    capped: d.capped,
    payable: d.payable,
    message: `${promo.code} applied 🎉 ${promoSummary(promo)} — you save ${formatNPR(d.amount)}${
      d.capped ? " (cap reached)" : ""
    }. Pay ${d.payable === 0 ? "nothing" : formatNPR(d.payable)}.`,
  };
}

/** Short line for notifications + receipts. */
export function promoDiscountNote(code: string, amount: number): string {
  return `🎟️ ${code} −${formatNPR(amount)}`;
}

/** A random-ish code owners can one-tap, e.g. "TURF25-4KQ7". */
export function suggestPromoCode(seedWord = "PLAY"): string {
  const word = normalizePromoCode(seedWord).replace(/-/g, "").slice(0, 8) || "PLAY";
  const alphabet = "ACDEFGHJKLMNPQRTUVWXY3479";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${word}-${tail}`.slice(0, PROMO_CODE_MAX);
}
