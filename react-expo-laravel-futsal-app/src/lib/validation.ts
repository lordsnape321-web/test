import { formatNPR } from "./futsal";
import {
  PROMO_CODE_MAX,
  PROMO_CODE_MIN,
  PROMO_DISCOUNT_TYPES,
  PROMO_MAX_CAP,
  PROMO_MAX_DAYS_AHEAD,
  PROMO_MAX_FLAT,
  PROMO_MAX_PERCENT,
  isValidDateISO,
  normalizePromoCode,
  promoDateISO,
} from "./promos";
import {
  TEAM_CODE_MAX,
  TEAM_CODE_MIN,
  TEAM_DESCRIPTION_MAX,
  normalizeTeamCode,
} from "./teams";

export type FieldError = string | null;

export function isBlank(v: unknown) {
  return v === undefined || v === null || String(v).trim() === "";
}

export function validateName(name: string, label = "Name"): FieldError {
  const t = String(name ?? "").trim();
  if (!t) return `${label} is required — what should we call you? 🙂`;
  if (t.length < 2) return `${label} needs at least 2 letters`;
  if (t.length > 60) return `${label} is too long (max 60 characters)`;
  if (!/^[A-Za-z][A-Za-z\s.'-]*$/.test(t))
    return `${label} can only have letters, spaces and . ' -`;
  if (/\s{2,}/.test(t)) return `${label} has extra spaces — tidy it up a little ✨`;
  return null;
}

export function validateEmail(email: string): FieldError {
  const t = String(email ?? "").trim().toLowerCase();
  if (!t) return "Email is required 📧";
  if (t.length > 100) return "That email is too long (max 100 characters)";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t))
    return "That doesn't look like an email — try you@example.com 📧";
  return null;
}

export function normalizePhone(raw: string) {
  return String(raw ?? "").trim().replace(/[\s\-()]/g, "");
}

export function validatePhone(phone: string, opts: { required?: boolean } = {}): FieldError {
  const required = opts.required ?? true;
  const t = normalizePhone(phone);
  if (!t) {
    if (required) return "Phone number is required 📱 (one account per number)";
    return null;
  }
  if (!/^\+?\d+$/.test(t)) return "Phone can only have digits (and + at the start) 📱";
  if (t.replace("+", "").length < 7) return "Phone is too short — needs 7–15 digits 📱";
  if (t.replace("+", "").length > 15) return "Phone is too long — needs 7–15 digits 📱";
  if (/^(\d)\1{6,}$/.test(t.replace("+", "")))
    return "That phone looks fake — please enter your real number 🙂";
  return null;
}

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  emoji: string;
  tips: string[];
};

export function passwordStrength(pw: string): PasswordStrength {
  const tips: string[] = [];
  let score = 0;
  if (pw.length >= 6) score++;
  else tips.push("at least 6 characters");
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  else tips.push("mix UPPER + lower case");
  if (/\d/.test(pw)) score++;
  else tips.push("add a number");
  if (/[^A-Za-z0-9]/.test(pw)) {
    score = Math.min(4, score + 1);
  }
  if (pw.length > 0 && pw.length < 6) {
    return { score: 0, label: "Too short", emoji: "🔴", tips };
  }
  if (score <= 1) return { score: 1, label: "Weak", emoji: "🟠", tips };
  if (score === 2) return { score: 2, label: "Okay", emoji: "🟡", tips };
  if (score === 3) return { score: 3, label: "Strong", emoji: "🟢", tips };
  return { score: 4, label: "Super strong", emoji: "💪", tips };
}

export function validatePassword(pw: string, opts: { min?: number; label?: string } = {}): FieldError {
  const min = opts.min ?? 6;
  const label = opts.label ?? "Password";
  const v = String(pw ?? "");
  if (!v) return `${label} is required 🔒`;
  if (v.length < min) return `${label} needs at least ${min} characters 🔒`;
  if (v.length > 100) return `${label} is too long (max 100 characters)`;
  if (/^\s|\s$/.test(v)) return `${label} can't start or end with spaces`;
  const weak = ["password", "123456", "qwerty", "futsal", "abcdef", "111111"];
  if (weak.includes(v.toLowerCase())) return "Too easy to guess — make it more unique! 🧠";
  return null;
}

export function validateSearch(q: string, opts: { max?: number; label?: string } = {}): FieldError {
  const max = opts.max ?? 60;
  const t = String(q ?? "").trim();
  if (!t) return null;
  if (t.length > max) return `Search is too long (max ${max} characters)`;
  if (/<|>|`|\\{|\\}/.test(t)) return "Search has odd characters — letters & numbers only 🔎";
  return null;
}

export function validateTitle(title: string, opts: { min?: number; max?: number; label?: string } = {}): FieldError {
  const min = opts.min ?? 3;
  const max = opts.max ?? 60;
  const label = opts.label ?? "Title";
  const t = String(title ?? "").trim();
  if (!t) return `${label} is required — give it some personality! ✨`;
  if (t.length < min) return `${label} needs at least ${min} characters`;
  if (t.length > max) return `${label} is too long (max ${max} characters)`;
  return null;
}

export function validateMessage(msg: string, opts: { min?: number; max?: number; label?: string; required?: boolean } = {}): FieldError {
  const min = opts.min ?? 3;
  const max = opts.max ?? 1000;
  const label = opts.label ?? "Message";
  const required = opts.required ?? true;
  const t = String(msg ?? "").trim();
  if (!t) {
    if (required) return `${label} is required — a few words help a lot! 💬`;
    return null;
  }
  if (t.length < min) return `${label} needs at least ${min} characters`;
  if (t.length > max) return `${label} is too long (max ${max} characters)`;
  return null;
}

export function validateNotes(notes: string): FieldError {
  const t = String(notes ?? "").trim();
  if (!t) return null;
  if (t.length > 500) return "Notes are too long (max 500 characters) 📝";
  return null;
}

export function validateMoney(n: unknown, opts: { min?: number; max?: number; label?: string } = {}): FieldError {
  const min = opts.min ?? 0;
  const max = opts.max ?? 100000;
  const label = opts.label ?? "Price";
  if (n === "" || n === undefined || n === null) return `${label} is required 💰`;
  const v = Number(n);
  if (!Number.isFinite(v)) return `${label} must be a number 💰`;
  if (!Number.isInteger(v)) return `${label} must be a whole number (no decimals) 💰`;
  if (v < min) return `${label} must be at least Rs. ${min.toLocaleString()} 💰`;
  if (v > max) return `${label} is too high (max Rs. ${max.toLocaleString()}) 💰`;
  return null;
}

export function validateCrew(n: unknown, opts: { min?: number; max?: number; label?: string } = {}): FieldError {
  const min = opts.min ?? 1;
  const max = opts.max ?? 21;
  const label = opts.label ?? "Players";
  if (n === "" || n === undefined || n === null) return `${label} is required 👥`;
  const v = Number(n);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return `${label} must be a whole number 👥`;
  if (v < min) return `${label} needs at least ${min} 👥`;
  if (v > max) return `${label} can't be more than ${max} 👥`;
  return null;
}

export function validateTotalPlayers(total: number): FieldError {
  if (!Number.isFinite(total)) return "Total players must be a number 🤝";
  if (total < 4) return "You need at least 4 players total for a proper game 🤝";
  if (total > 22) return "Max 22 players total — that's already a festival! 🎪";
  return null;
}

export function validateCustomPrice(
  custom: unknown,
  opts: { total: number; openSpots: number; max?: number } = { total: 0, openSpots: 1 }
): FieldError {
  if (custom === "" || custom === undefined || custom === null)
    return "Set a price per joiner — or switch back to auto-split 💰";
  const v = Number(custom);
  if (!Number.isFinite(v) || !Number.isInteger(v))
    return "Custom price must be a whole number 💰";
  if (v < 0) return "Custom price can't be negative 🙂";
  const max = opts.max ?? 10000;
  if (v > max) return `Custom price is too high (max Rs. ${max.toLocaleString()}) 💰`;
  return null;
}

export function validateDateISO(dateISO: string, opts: { label?: string; allowPast?: boolean; maxDaysAhead?: number } = {}): FieldError {
  const label = opts.label ?? "Date";
  const t = String(dateISO ?? "").trim();
  if (!t) return `${label} is required 📅`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${label} looks wrong (use YYYY-MM-DD) 📅`;
  const d = new Date(t + "T00:00:00");
  if (Number.isNaN(d.getTime())) return `${label} isn't a real date 📅`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!opts.allowPast && d < today) return `${label} can't be in the past — pick today or later 📅`;
  if (opts.maxDaysAhead) {
    const max = new Date(today);
    max.setDate(max.getDate() + opts.maxDaysAhead);
    if (d > max) return `${label} is too far ahead (max ${opts.maxDaysAhead} days) 📅`;
  }
  return null;
}

export function validateTimeHM(time: string, label = "Time"): FieldError {
  const t = String(time ?? "").trim();
  if (!t) return `${label} is required 🕐`;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return `${label} looks wrong (use HH:MM) 🕐`;
  return null;
}

export function validateHours(h: unknown): FieldError {
  const v = Number(h);
  if (![1, 2, 3].includes(v)) return "Pick 1, 2 or 3 hours ⏱️";
  return null;
}

export function validateVenueName(name: string): FieldError {
  return validateTitle(name, { min: 3, max: 80, label: "Venue name" });
}

export function validateAddress(addr: string): FieldError {
  const t = String(addr ?? "").trim();
  if (!t) return "Address is required — players need to find you! 📍";
  if (t.length < 5) return "Address is too short — add area + city 📍";
  if (t.length > 200) return "Address is too long (max 200 characters)";
  return null;
}

export function validateDescription(desc: string, opts: { required?: boolean; max?: number } = {}): FieldError {
  const t = String(desc ?? "").trim();
  const max = opts.max ?? 1000;
  if (!t) {
    if (opts.required) return "Description is required — tell your story! 💛";
    return null;
  }
  if (t.length < 10) return "Description needs at least 10 characters 💛";
  if (t.length > max) return `Description is too long (max ${max} characters)`;
  return null;
}

export function validateHoursRange(open: unknown, close: unknown): FieldError {
  const o = Number(open);
  const c = Number(close);
  if (!Number.isInteger(o) || o < 0 || o > 23) return "Opening hour must be 0–23 🕐";
  if (!Number.isInteger(c) || c < 1 || c > 24) return "Closing hour must be 1–24 🕐";
  if (c <= o) return "Closing time must be after opening time 🕐";
  if (c - o < 2) return "Venue should be open at least 2 hours a day 🕐";
  if (c - o > 20) return "That's a marathon day! Keep it under 20 hours 😅";
  return null;
}

export function validateCourtName(name: string): FieldError {
  return validateTitle(name, { min: 2, max: 60, label: "Court name" });
}

export const VALID_PAYMENTS = ["eSewa", "Khalti", "Cash at Venue"];

export function validatePaymentMethods(methods: unknown): FieldError {
  if (!Array.isArray(methods)) return "Pick at least one payment method 💳";
  const clean = (methods as unknown[]).map((m) => String(m).trim()).filter(Boolean);
  if (clean.length === 0) return "Pick at least one payment method 💳 — cash, eSewa or Khalti";
  const bad = clean.filter((m) => !VALID_PAYMENTS.includes(m));
  if (bad.length > 0) return `Unknown payment method: ${bad.join(", ")} 💳`;
  return null;
}

export function validateDepositPercent(p: unknown): FieldError {
  if (p === "" || p === undefined || p === null) return "Deposit % is required 🛡️";
  const v = Number(p);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return "Deposit % must be a whole number 🛡️";
  if (v < 0) return "Deposit % can't be negative 🙂";
  if (v > 100) return "Deposit % can't be more than 100 🛡️";
  if (v > 0 && v < 10) return "Deposit must be 0 (off) or at least 10% 🛡️";
  return null;
}

/* ----------------------------- Promo codes 🎟️ ----------------------------- */

export function validatePromoCode(code: unknown): FieldError {
  const raw = String(code ?? "").trim();
  if (!raw) return "Promo code is required 🎟️";
  const t = normalizePromoCode(raw);
  if (t.length < PROMO_CODE_MIN) return `Promo code needs at least ${PROMO_CODE_MIN} characters 🎟️`;
  if (t.length > PROMO_CODE_MAX) return `Promo code is too long (max ${PROMO_CODE_MAX} characters) 🎟️`;
  if (!/^[A-Z0-9-]+$/.test(t)) return "Promo code can only have letters, numbers and dashes 🎟️";
  if (!/^[A-Z0-9]/.test(t) || !/[A-Z0-9]$/.test(t))
    return "Promo code should start and end with a letter or number 🎟️";
  if (/^-{2,}/.test(t) || /\d{8,}/.test(t)) return "That promo code is a bit odd — keep it simple 🎟️";
  const reserved = ["FREE", "FREEPLAY", "PROMO", "DISCOUNT", "ADMIN", "NULL"];
  if (reserved.includes(t)) return `"${t}" is reserved — pick something more specific 🎟️`;
  return null;
}

export function validatePromoTitle(title: unknown): FieldError {
  return validateTitle(String(title ?? ""), { min: 3, max: 60, label: "Promo name" });
}

export function validateDiscountType(type: unknown): FieldError {
  if (!PROMO_DISCOUNT_TYPES.includes(String(type))) return "Pick percent or flat discount 🎟️";
  return null;
}

export function validateDiscountValue(value: unknown, type: unknown): FieldError {
  const kind = String(type) === "flat" ? "flat" : "percent";
  if (value === "" || value === undefined || value === null)
    return kind === "flat" ? "How many rupees off? 💸" : "What % off? 💸";
  const v = Number(value);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return "Discount must be a whole number 💸";
  if (v <= 0) return "Discount must be more than 0 — otherwise it's not a discount 🙂";
  if (kind === "percent") {
    if (v > PROMO_MAX_PERCENT) return `Percent off can't be more than ${PROMO_MAX_PERCENT} 💸`;
    return null;
  }
  if (v > PROMO_MAX_FLAT) return `Flat discount is too big (max ${formatNPR(PROMO_MAX_FLAT)}) 💸`;
  return null;
}

/** 0 = no cap. Percent codes only. */
export function validateMaxDiscount(value: unknown): FieldError {
  if (value === "" || value === undefined || value === null) return null;
  const v = Number(value);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return "Discount cap must be a whole number 🧢";
  if (v < 0) return "Discount cap can't be negative 🧢";
  if (v > PROMO_MAX_CAP) return `Discount cap is too big (max ${formatNPR(PROMO_MAX_CAP)}) 🧢`;
  return null;
}

export function validateMinBookingAmount(value: unknown): FieldError {
  if (value === "" || value === undefined || value === null) return null;
  const v = Number(value);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return "Minimum booking must be a whole number 💰";
  if (v < 0) return "Minimum booking can't be negative 💰";
  if (v > PROMO_MAX_CAP) return `Minimum booking is too big (max ${formatNPR(PROMO_MAX_CAP)}) 💰`;
  return null;
}

/** 0 = unlimited. */
export function validateUsageLimit(value: unknown, label = "Usage limit"): FieldError {
  if (value === "" || value === undefined || value === null) return null;
  const v = Number(value);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return `${label} must be a whole number 🔢`;
  if (v < 0) return `${label} can't be negative (0 = unlimited) 🔢`;
  if (v > 100000) return `${label} is too big (max 100,000) 🔢`;
  return null;
}

export function validatePromoWindow(startsAt: unknown, expiresAt: unknown): FieldError {
  const start = String(startsAt ?? "").trim();
  const end = String(expiresAt ?? "").trim();
  if (!end) return "Expiry date is required — when does this code stop working? 📅";
  if (!isValidDateISO(end)) return "Expiry date looks wrong (use YYYY-MM-DD) 📅";
  if (start && !isValidDateISO(start)) return "Start date looks wrong (use YYYY-MM-DD) 📅";
  if (start && start > end) return "Start date must be on or before the expiry date 📅";
  const today = promoDateISO();
  if (end < today) return "Expiry date can't be in the past — nobody could use it 📅";
  const far = new Date();
  far.setDate(far.getDate() + PROMO_MAX_DAYS_AHEAD);
  if (new Date(`${end}T00:00:00`) > far)
    return `Expiry is too far ahead (max ${PROMO_MAX_DAYS_AHEAD} days) 📅`;
  return null;
}

export const VALID_CITIES = ["All Cities", "Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan"];

export function validateCity(city: string, label = "City"): FieldError {
  const t = String(city ?? "").trim();
  if (!t) return `${label} is required 📍`;
  if (!VALID_CITIES.includes(t)) return `Pick a valid city 📍`;
  return null;
}

export function validateAvatarUrl(url: string): FieldError {
  const t = String(url ?? "").trim();
  if (!t) return null;
  if (t.length > 2000000) return "Photo is too large — use under 2.5MB 📸";
  if (t.startsWith("data:image/")) return null;
  if (/^https?:\/\/.+\..+/.test(t)) return null;
  return "Photo must be an uploaded image or https link 📸";
}

/**
 * The unique handle other players search a team by. Same shape rules as a promo
 * code so both feel like one system; uniqueness itself is checked against the
 * database in POST /api/teams, not here.
 */
export function validateTeamCode(
  code: unknown,
  opts: { required?: boolean } = {}
): FieldError {
  const raw = String(code ?? "").trim();
  if (!raw)
    return opts.required === false
      ? null
      : "Your team needs a unique code so others can find it 🛡️";
  const t = normalizeTeamCode(raw);
  if (t.length < TEAM_CODE_MIN)
    return `Team code needs at least ${TEAM_CODE_MIN} characters 🛡️`;
  if (t.length > TEAM_CODE_MAX)
    return `Team code is too long (max ${TEAM_CODE_MAX} characters) 🛡️`;
  if (!/^[A-Z0-9-]+$/.test(t))
    return "Team code can only have letters, numbers and dashes 🛡️";
  if (!/^[A-Z0-9]/.test(t) || !/[A-Z0-9]$/.test(t))
    return "Team code should start and end with a letter or number 🛡️";
  if (/^-{2,}/.test(t) || /\d{8,}/.test(t))
    return "That team code is a bit odd — keep it simple 🛡️";
  const reserved = ["TEAM", "TEAMS", "ADMIN", "NULL", "SEARCH", "JOIN", "NONE"];
  if (reserved.includes(t))
    return `"${t}" is reserved — pick something specific to your squad 🛡️`;
  return null;
}

/** Optional note a player sends along with a join request. */
export function validateJoinMessage(msg: unknown): FieldError {
  const t = String(msg ?? "").trim();
  if (!t) return null;
  if (t.length > 200) return "Keep your join note under 200 characters 📝";
  return null;
}

/**
 * The note a captain writes on an invitation. Same cap as a join note on purpose:
 * both are "a sentence or two about why", and one shared limit stops the two sides
 * of the flow from feeling like different products.
 */
export function validateInviteMessage(msg: unknown): FieldError {
  const t = String(msg ?? "").trim();
  if (!t) return null;
  if (t.length > 200) return "Keep your invite note under 200 characters 📝";
  return null;
}

/** Optional "about us" box on a squad — see `teams.description`. */
export function validateTeamDescription(desc: unknown): FieldError {
  const t = String(desc ?? "").trim();
  if (!t) return null;
  if (t.length < 10)
    return "Give the description a little more to say — at least 10 characters ✍️";
  if (t.length > TEAM_DESCRIPTION_MAX)
    return `Team description is too long (max ${TEAM_DESCRIPTION_MAX} characters) 📝`;
  return null;
}

/**
 * The optional squad selector on a booking. Blank or 0 means "individual
 * booking" and is always allowed — a player in no team has nothing to pick, and
 * picking "Just me" is a legitimate choice for a player who is in teams.
 * Actual membership is verified server-side in POST /api/bookings, not here.
 */
export function validateTeamId(value: unknown): FieldError {
  if (isBlank(value) || Number(value) === 0) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    return "Pick one of your teams, or book individually 🛡️";
  return null;
}

export function firstError(...errs: FieldError[]): FieldError {
  for (const e of errs) {
    if (e) return e;
  }
  return null;
}
