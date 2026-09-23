export const LOYALTY_TARGET = 7;
export const CANCEL_LIMIT_PER_MONTH = 3;
export const CANCEL_CUTOFF_HOURS = 6;

// Fair-play deposits: low-trust players pay a cut upfront (non-refundable).
export const DEPOSIT_RATING_THRESHOLD = 3.5;
export const DEPOSIT_CANCEL_THRESHOLD = 2;
export const DEPOSIT_TRUST_THRESHOLD = 70;
export const DEPOSIT_MIN_PERCENT = 10;
export const DEPOSIT_MAX_PERCENT = 100;
export const TRUST_START = 100;
export const TRUST_COMPLETE_BOOST = 8;
export const TRUST_CANCEL_PENALTY = 15;

export const PAYMENT_OPTIONS = ["eSewa", "Khalti", "Cash at Venue"];
export const ONLINE_PAYMENTS = ["eSewa", "Khalti"];

export function parsePayments(raw: unknown): string[] {
  const list = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => PAYMENT_OPTIONS.includes(s));
  return list.length > 0 ? list : [...PAYMENT_OPTIONS];
}

export function monthKey(d: Date = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  try {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  } catch {
    return key;
  }
}

export type PlayerStats = {
  completed: number;
  cancelled: number;
  pending: number;
  confirmed: number;
  total: number;
  rating: number;
  label: string;
  emoji: string;
  cancelsThisMonth: number;
  blocked: boolean;
  trustScore: number;
  trustLabel: string;
  trustEmoji: string;
  depositRequired: boolean;
  depositReason: string;
};

export function trustLabel(score: number): { label: string; emoji: string } {
  if (score >= 85) return { label: "Trusted star", emoji: "💎" };
  if (score >= 70) return { label: "Good standing", emoji: "✅" };
  if (score >= 50) return { label: "Needs care", emoji: "⚠️" };
  return { label: "Low trust", emoji: "🚨" };
}

export function trustAfterComplete(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score + TRUST_COMPLETE_BOOST)));
}

export function trustAfterCancel(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score - TRUST_CANCEL_PENALTY)));
}

/** Deposit needed? Low stars, repeat cancels, or low trust score. */
export function depositDecision(
  stats: { rating: number; total: number; cancelsThisMonth: number },
  trustScore: number,
  venuePercent: number
): { required: boolean; percent: number; reason: string } {
  const percent = Math.min(
    DEPOSIT_MAX_PERCENT,
    Math.max(DEPOSIT_MIN_PERCENT, Math.round(venuePercent || 30))
  );
  if (stats.total > 0 && stats.rating < DEPOSIT_RATING_THRESHOLD) {
    return {
      required: true,
      percent,
      reason: `Fair-play shield 🛡️ — your ${stats.rating.toFixed(1)}★ rating is below ${DEPOSIT_RATING_THRESHOLD}★, so a ${percent}% upfront deposit keeps the court safe. Finish this game without cancelling and your trust jumps back up! 💪`,
    };
  }
  if (stats.cancelsThisMonth >= DEPOSIT_CANCEL_THRESHOLD) {
    return {
      required: true,
      percent,
      reason: `Fair-play shield 🛡️ — ${stats.cancelsThisMonth} cancels this month. A ${percent}% non-refundable deposit applies. Show up this time and rebuild trust! 💪`,
    };
  }
  if (trustScore < DEPOSIT_TRUST_THRESHOLD) {
    return {
      required: true,
      percent,
      reason: `Fair-play shield 🛡️ — trust score ${trustScore}/100 is below ${DEPOSIT_TRUST_THRESHOLD}. A ${percent}% upfront deposit applies (non-refundable if you cancel). Complete this game to boost trust! 🌟`,
    };
  }
  return { required: false, percent, reason: "" };
}

export function depositAmountFor(totalPrice: number, percent: number): number {
  if (totalPrice <= 0) return 0;
  return Math.max(1, Math.round((totalPrice * percent) / 100));
}

/** Reliability rating out of 5 from booking history. */
export function playerRating(
  bookings: Array<{ status: string; createdAt?: Date | string | null }>,
  now = new Date(),
  trustScore: number = TRUST_START
): PlayerStats {
  const completed = bookings.filter((b) => b.status === "completed").length;
  const cancelled = bookings.filter((b) => b.status === "cancelled").length;
  const pending = bookings.filter((b) => b.status === "pending").length;
  const confirmed = bookings.filter((b) => b.status === "confirmed").length;
  const total = bookings.length;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const cancelsThisMonth = bookings.filter((b) => {
    if (b.status !== "cancelled" || !b.createdAt) return false;
    try {
      return new Date(b.createdAt) >= monthStart;
    } catch {
      return false;
    }
  }).length;

  // 5 stars, minus for cancels. Completed games heal the score.
  const decisive = completed + cancelled;
  let rating = 5;
  if (decisive > 0) {
    rating = Math.round(((completed / decisive) * 5 + Number.EPSILON) * 10) / 10;
    if (completed === 0 && cancelled > 0) rating = Math.max(1, 5 - cancelled * 0.8);
  }

  let label = "Super reliable";
  let emoji = "🌟";
  if (total === 0) {
    label = "New player";
    emoji = "🌱";
  } else if (rating >= 4.5) {
    label = "Super reliable";
    emoji = "🌟";
  } else if (rating >= 3.5) {
    label = "Reliable";
    emoji = "✅";
  } else if (rating >= 2.5) {
    label = "Needs care";
    emoji = "⚠️";
  } else {
    label = "At risk";
    emoji = "🚨";
  }

  const safeTrust = Math.min(100, Math.max(0, Math.round(trustScore ?? TRUST_START)));
  const t = trustLabel(safeTrust);
  const dep = depositDecision({ rating, total, cancelsThisMonth }, safeTrust, 30);

  return {
    completed,
    cancelled,
    pending,
    confirmed,
    total,
    rating,
    label,
    emoji,
    cancelsThisMonth,
    blocked: cancelsThisMonth >= CANCEL_LIMIT_PER_MONTH,
    trustScore: safeTrust,
    trustLabel: t.label,
    trustEmoji: t.emoji,
    depositRequired: dep.required,
    depositReason: dep.reason,
  };
}

/** Hours until a game starts. Negative if in the past. */
export function hoursUntilGame(dateISO: string, startTime: string, now = new Date()) {
  try {
    const game = new Date(`${dateISO}T${startTime}:00`);
    return (game.getTime() - now.getTime()) / 3600000;
  } catch {
    return 999;
  }
}

export function canCancel(dateISO: string, startTime: string, now = new Date()) {
  return hoursUntilGame(dateISO, startTime, now) >= CANCEL_CUTOFF_HOURS;
}

export function stars(rating: number) {
  const full = Math.round(rating);
  return "★".repeat(Math.max(0, Math.min(5, full))) + "☆".repeat(5 - Math.max(0, Math.min(5, full)));
}
