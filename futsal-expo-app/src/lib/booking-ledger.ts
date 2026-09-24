import type { FieldError } from "./validation";

/**
 * The money side of a booking 💸
 *
 * A booking's price is taken in advance, but the real total isn't known until
 * the game is over — players buy water, the owner adds an extra ball — and the
 * money rarely arrives in one lump. A Rs 1,700 court might be settled as
 * 700 eSewa + 500 Khalti + 500 cash at the desk.
 *
 * So nothing here trusts `booking.paidAmount` on its own. Every figure is
 * derived from the ledger rows (`booking_payments`, `booking_extras`), which is
 * what makes "how much do they still owe, and by which medium did it come in"
 * answerable from the database rather than from a flag somebody flipped.
 */

/** The mediums a venue can accept. Mirrors `venue.acceptedPayments`. */
export const LEDGER_METHODS = ["eSewa", "Khalti", "Cash at Venue"] as const;
export type LedgerMethod = (typeof LEDGER_METHODS)[number];

/**
 * After the owner marks a booking settled, the ledger stays editable this long
 * so a mistyped amount can be corrected. Then it locks — the API refuses
 * changes — because a settled book is what the venue reconciles its day against.
 */
export const SETTLE_EDIT_WINDOW_MS = 5 * 60 * 1000;

/** A single extra charge line — "Water x10" for Rs 300. */
export type ExtraLine = {
  id: number;
  label: string;
  amount: number;
  voidedAt?: string | Date | null;
};

/** One instalment — a medium, an amount, and who put it in. */
export type PaymentLine = {
  id: number;
  amount: number;
  method: string;
  note?: string;
  source?: string;
  voidedAt?: string | Date | null;
};

/** Row is live unless it was voided inside the correction window. */
export function isLive(row: { voidedAt?: string | Date | null }): boolean {
  return !row.voidedAt;
}

export function sumLive(rows: Array<{ amount: number; voidedAt?: string | Date | null }>): number {
  return rows.filter(isLive).reduce((t, r) => t + (Number(r.amount) || 0), 0);
}

export type LedgerTotals = {
  /** The court fee, after any promo discount already applied to it. */
  courtPrice: number;
  /** Sum of the live extra-charge lines. */
  extrasTotal: number;
  /** What the booking actually costs: court + extras. */
  owed: number;
  /** Sum of the live instalments. */
  paid: number;
  /** Still to collect. 0 once settled or over. */
  balance: number;
  /** Paid past what was owed — the change the venue owes back. */
  surplus: number;
  /** How much came in per medium, live rows only. */
  byMethod: Record<string, number>;
  settled: boolean;
};

/**
 * The whole picture for one booking. `balance` and `surplus` are two halves of
 * the same difference — a booking is never both owing and over — so the UI can
 * show "Rs 400 to collect" or "Rs 400 change due" off one call.
 */
export function ledgerTotals(opts: {
  courtPrice: number;
  extras: ExtraLine[];
  payments: PaymentLine[];
  settled?: boolean;
}): LedgerTotals {
  const courtPrice = Math.max(0, Math.round(Number(opts.courtPrice) || 0));
  const extrasTotal = sumLive(opts.extras ?? []);
  const paid = sumLive(opts.payments ?? []);
  const owed = courtPrice + extrasTotal;
  const diff = paid - owed;
  const byMethod: Record<string, number> = {};
  for (const p of (opts.payments ?? []).filter(isLive)) {
    const key = p.method || "Unspecified";
    byMethod[key] = (byMethod[key] ?? 0) + (Number(p.amount) || 0);
  }
  return {
    courtPrice,
    extrasTotal,
    owed,
    paid,
    balance: diff < 0 ? -diff : 0,
    surplus: diff > 0 ? diff : 0,
    byMethod,
    settled: Boolean(opts.settled),
  };
}

export type SettleWindow = {
  settled: boolean;
  /** True while a settled booking can still be corrected. */
  editable: boolean;
  msLeft: number;
  locksAt: number | null;
};

/**
 * Is the ledger still open for correction? An unsettled booking is always
 * editable — the window only starts when the owner marks it settled, which is
 * the moment a typo becomes expensive.
 */
export function settleWindow(
  settledAt: string | Date | null | undefined,
  now: number = Date.now()
): SettleWindow {
  if (!settledAt) {
    return { settled: false, editable: true, msLeft: 0, locksAt: null };
  }
  const at = new Date(settledAt).getTime();
  if (!Number.isFinite(at)) {
    return { settled: false, editable: true, msLeft: 0, locksAt: null };
  }
  const msLeft = Math.max(0, at + SETTLE_EDIT_WINDOW_MS - now);
  return { settled: true, editable: msLeft > 0, msLeft, locksAt: at + SETTLE_EDIT_WINDOW_MS };
}

/** "4:32" — what the owner watches while the correction window ticks down. */
export function formatWindowLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Extra charges are the easy place to fat-finger a number, so the amount is
 * bounded the same way a court price is and the description can't be blank —
 * an unnamed Rs 3,000 on somebody's bill is worse than no charge at all.
 */
export function validateExtraLine(
  label: unknown,
  amount: unknown,
  opts: { max?: number } = {}
): FieldError {
  const max = opts.max ?? 100000;
  const text = String(label ?? "").trim();
  if (!text) return "Say what the extra charge is for 🧾";
  if (text.length > 120) return "That description is too long (max 120 characters) 🧾";
  const v = Number(amount);
  if (amount === "" || amount === undefined || amount === null)
    return "The extra charge needs an amount 🧾";
  if (!Number.isFinite(v)) return "The extra charge must be a number 🧾";
  if (!Number.isInteger(v)) return "The extra charge must be a whole number (no decimals) 🧾";
  if (v <= 0) return "The extra charge must be more than zero 🧾";
  if (v > max) return `The extra charge is too high (max Rs. ${max.toLocaleString()}) 🧾`;
  return null;
}

/**
 * An instalment must be a positive whole number in a medium the venue actually
 * takes. Overpaying is allowed and handled by `surplus` — a player handing over
 * Rs 2,000 for a Rs 1,700 game is normal at a desk, not an error to reject.
 */
export function validateInstalment(
  amount: unknown,
  method: unknown,
  opts: { allowed?: readonly string[]; max?: number } = {}
): FieldError {
  const max = opts.max ?? 100000;
  const allowed = opts.allowed ?? LEDGER_METHODS;
  const v = Number(amount);
  if (amount === "" || amount === undefined || amount === null)
    return "Enter how much was paid 💰";
  if (!Number.isFinite(v)) return "That amount isn't a number 💰";
  if (!Number.isInteger(v)) return "That amount must be a whole number (no decimals) 💰";
  if (v <= 0) return "That amount must be more than zero 💰";
  if (v > max) return `That amount is too high (max Rs. ${max.toLocaleString()}) 💰`;
  const m = String(method ?? "").trim();
  if (!allowed.includes(m))
    return `This venue doesn't take "${m || "nothing"}" — pick ${allowed.join(" or ")} 💰`;
  return null;
}
