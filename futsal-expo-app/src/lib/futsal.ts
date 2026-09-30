import type { CourtDayHours } from "@/lib/types";

export function formatNPR(n: number) {
  return "Rs. " + n.toLocaleString("en-IN");
}

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function prettyDate(iso: string) {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function prettyDayShort(iso: string) {
  try {
    const d = new Date(iso + "T00:00:00");
    return {
      dow: d.toLocaleDateString("en-US", { weekday: "short" }),
      day: d.getDate(),
      month: d.toLocaleDateString("en-US", { month: "short" }),
    };
  } catch {
    return { dow: "", day: 0, month: "" };
  }
}

export function next7Days() {
  return Array.from({ length: 7 }, (_, i) => todayISO(i));
}

export function next14Days() {
  return Array.from({ length: 14 }, (_, i) => todayISO(i));
}

export function timeSlots(open = 6, close = 22): string[] {
  const slots: string[] = [];
  for (let h = open; h < close; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }
  return slots;
}

export function addHours(time: string, hours: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export function timeToMin(t: string) {
  const [h, m] = (t || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Do two [start, end) ranges overlap? Times as "HH:MM". */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const s1 = timeToMin(aStart);
  let e1 = timeToMin(aEnd);
  const s2 = timeToMin(bStart);
  let e2 = timeToMin(bEnd);
  if (e1 <= s1) e1 = s1 + 60;
  if (e2 <= s2) e2 = s2 + 60;
  return s1 < e2 && s2 < e1;
}

/** Expand a booking into the hourly slot starts it covers, e.g. 18:00 + 2h -> ["18:00","19:00"] */
export function expandBookingSlots(startTime: string, durationHours: number): string[] {
  const out: string[] = [];
  const n = Math.max(1, Math.round(durationHours || 1));
  for (let i = 0; i < n; i++) {
    out.push(addHours(startTime, i));
  }
  return out;
}

/** Consecutive range of `hours` slots starting at `start` within the day's `slots` list. Empty if it would overflow. */
export function rangeSlots(slots: string[], start: string | null, hours: number): string[] {
  if (!start) return [];
  const idx = slots.indexOf(start);
  if (idx < 0) return [];
  if (idx + hours > slots.length) return [];
  return slots.slice(idx, idx + hours);
}

/** "18:00" → "6:00 PM"; already-12-hour text is left alone. */
export function formatTime12(t: string) {
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${ampm}`;
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** The few booking fields `gamePlayed` needs, so any caller can pass a row or a card. */
export type GameSlot = {
  status: string;
  date: string;
  startTime: string;
  endTime: string;
};

/**
 * Has this booking's game already been played? 🏁
 *
 * One rule, shared by every "played" gate in the app — the bookings page tabs,
 * the lock on a finished booking, and review eligibility:
 *
 * - `completed` → played (the venue marked it so).
 * - `confirmed` → played once the end time has passed.
 * - `pending` / `rejected` → never played; that game never happened, however
 *   far in the past the date is.
 *
 * Both the API and the client import this so a card can't disagree with the
 * server about whether a game is over.
 */
export function gamePlayed(b: GameSlot, now: Date = new Date()) {
  if (b.status === "completed") return true;
  if (b.status !== "confirmed") return false;
  const end = b.endTime || b.startTime;
  if (!b.date || !end) return false;
  try {
    // Parsed without a zone on purpose: booking times are the venue's wall
    // clock, and this matches how the rest of the app compares them.
    return now > new Date(`${b.date}T${end}:00`);
  } catch {
    return false;
  }
}

export const CITY_OPTIONS = [
  "All Cities",
  "Kathmandu",
  "Lalitpur",
  "Bhaktapur",
  "Pokhara",
  "Chitwan",
];

export const VENUE_IMAGES = [
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1553778263-73a83bab9b0c?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1522778119026-d647f0596c20?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1517466787929-bc90951d0974?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1606925797300-0b35e9d1794e?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1459865264687-595d652de67e?q=80&w=1200&auto=format&fit=crop",
];

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekday of a "YYYY-MM-DD" date, in the app's 0 = Sunday convention. */
export function weekdayOf(dateISO?: string | null): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateISO ?? "").trim());
  if (!match) return null;
  // Built from parts on purpose: `new Date("2026-09-30")` is parsed as UTC and
  // can land on the previous day west of Greenwich.
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay();
}

/** The venue shape the court-hours helpers need; hours may arrive as strings. */
export type CourtHoursVenue = {
  openingHour?: number | string | null;
  closingHour?: number | string | null;
};

/** Every half hour a court can open or close at, for the owner's pickers. */
export const CLOCK_OPTIONS: string[] = Array.from({ length: 49 }, (_, i) => {
  const minutes = i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/**
 * The hours one court actually trades in.
 *
 * A court with its own window keeps it; otherwise it follows the venue, which
 * is what every court did before per-court hours existed.
 */
export function courtHours(
  court?: { opensAt?: string | null; closesAt?: string | null; dayHours?: CourtDayHours[] | null } | null,
  venue?: CourtHoursVenue | null,
  dateISO?: string | null,
): { opensAt: string; closesAt: string; inherited: boolean; day: number | null } {
  // A weekday the owner singled out wins over the court's every-day window.
  const day = weekdayOf(dateISO);
  const override = day === null
    ? null
    : (court?.dayHours ?? []).find((row) => Number(row.dayOfWeek) === day && row.opensAt && row.closesAt) ?? null;

  if (override) {
    return { opensAt: override.opensAt, closesAt: override.closesAt, inherited: false, day };
  }

  const opens = court?.opensAt ?? "";
  const closes = court?.closesAt ?? "";
  if (opens && closes) return { opensAt: opens, closesAt: closes, inherited: false, day };
  // A venue that somehow carries no hours falls back to the historic 6–22,
  // never to 0–0 (which would leave a court with no slots at all).
  const open = venueHour(venue?.openingHour, 6);
  const close = venueHour(venue?.closingHour, 22);
  return {
    opensAt: `${String(open).padStart(2, "0")}:00`,
    closesAt: `${String(close).padStart(2, "0")}:00`,
    inherited: true,
    day,
  };
}

/** A venue hour as a number, tolerating the nulls and strings JSON can carry. */
function venueHour(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The weekday overrides of a court, ready to print: "Fri 6:00 PM–11:00 PM".
 *
 * Times are formatted 12-hour wherever a time sits next to a clock, so a court
 * row never mixes "18:00" with the "6:00 PM" used by the slots below it.
 */
export function courtDaySummary(
  court?: { dayHours?: CourtDayHours[] | null } | null,
): string {
  return (court?.dayHours ?? [])
    .filter((row) => row.opensAt && row.closesAt)
    .slice()
    .sort((a, b) => Number(a.dayOfWeek) - Number(b.dayOfWeek))
    .map((row) => `${DAY_SHORT[Number(row.dayOfWeek)] ?? "?"} ${formatTime12(row.opensAt)}–${formatTime12(row.closesAt)}`)
    .join(" · ");
}

/** Slot list for a court: only the hours it is actually open. */
export function courtTimeSlots(
  court?: { opensAt?: string | null; closesAt?: string | null; dayHours?: CourtDayHours[] | null } | null,
  venue?: CourtHoursVenue | null,
  dateISO?: string | null,
): string[] {
  const { opensAt, closesAt } = courtHours(court, venue, dateISO);
  const from = timeToMin(opensAt);
  const to = timeToMin(closesAt);
  const slots: string[] = [];
  for (let minutes = from; minutes + 60 <= to; minutes += 60) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  return slots;
}
