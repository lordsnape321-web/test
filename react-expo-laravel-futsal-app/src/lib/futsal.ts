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
