/**
 * End-to-end smoke test for the vertical slice.
 *
 * This drives the SAME modules the app ships — src/lib/api.ts and src/api/index.ts
 * — against a live backend. It is not a re-implementation: if apiUrl(), apiJson()
 * or any route contract is wrong, this fails.
 *
 * Flow: signup → venues → courts → availability → create booking → ledger →
 *       pay (eSewa, sandbox) → re-read ledger → assert settled.
 *
 * Run via: npm run smoke   (bundles with esbuild, then executes in Node)
 * Requires the backend at EXPO_PUBLIC_API_BASE (default http://localhost:3000).
 */

import {
  createBooking,
  fetchAvailability,
  fetchBooking,
  fetchCourts,
  fetchLedger,
  fetchVenues,
  signup,
  verifyEsewa,
} from "@/api";
import { addHours, timeSlots, todayISO } from "@/lib/futsal";

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const stamp = Date.now();
  // Phone must be 7–15 digits; email must be unique. Both derive from the stamp.
  const email = `smoke${stamp}@example.com`;
  const phone = `98${String(stamp).slice(-8)}`;

  console.log("\n=== Expo vertical-slice smoke test ===\n");

  // 1. Sign up a fresh player.
  const { user } = await signup({
    name: "Smoke Tester",
    email,
    phone,
    password: "password123",
    level: "Intermediate",
    position: "All-rounder",
  });
  check("signup returns a user", !!user && typeof user.id === "number", `id=${user.id}`);
  check("signup email matches", user.email === email, user.email);

  // 2. List venues.
  const venues = await fetchVenues();
  check("venues list is non-empty", venues.length > 0, `${venues.length} venues`);

  // The slice pays via eSewa, so pick a venue that accepts it and has courts.
  // acceptedPayments is a comma-separated string, not an array.
  const acceptsEsewa = (v: { acceptedPayments?: string | null }) =>
    (v.acceptedPayments ?? "")
      .split(",")
      .map((s) => s.trim())
      .includes("eSewa");
  const venue =
    venues.find((v) => (v.courtCount ?? 0) > 0 && acceptsEsewa(v)) ??
    venues.find((v) => (v.courtCount ?? 0) > 0) ??
    venues[0];
  check("picked a venue with courts", !!venue, venue?.name);
  check("venue accepts eSewa", acceptsEsewa(venue), venue?.acceptedPayments ?? "none");

  // 3. Courts for that venue.
  const courts = await fetchCourts(venue.id);
  check("venue has active courts", courts.length > 0, `${courts.length} courts`);
  const court = courts[0];

  // 4. Availability for a near-future day.
  const date = todayISO(2);
  const { booked } = await fetchAvailability(court.id, date);
  check("availability returns a booked list", Array.isArray(booked), `${booked.length} booked`);

  // 5. Pick the first free slot for a 1-hour booking.
  const slots = timeSlots(venue.openingHour, venue.closingHour);
  const bookedSet = new Set(booked);
  const start = slots.find((s) => !bookedSet.has(s));
  check("found a free start slot", !!start, start ?? "none");
  if (!start) throw new Error("no free slot — cannot continue");

  // 6. Create the booking.
  const { booking } = await createBooking({
    courtId: court.id,
    userId: user.id,
    date,
    startTime: start,
    durationHours: 1,
    bookerName: user.name,
    bookerPhone: user.phone,
    paymentMethod: "eSewa",
  });
  check("booking created", !!booking && typeof booking.id === "number", `id=${booking.id}`);
  check("booking endTime = start + 1h", booking.endTime === addHours(start, 1), booking.endTime);
  check("booking starts unpaid", booking.paidAmount === 0, `paid=${booking.paidAmount}`);

  // 7. Ledger before payment.
  const before = await fetchLedger(booking.id);
  check("ledger owed > 0 before payment", before.totals.owed > 0, `owed=${before.totals.owed}`);
  check("ledger balance = owed before payment", before.totals.balance === before.totals.owed);
  check("ledger not settled yet", before.window.settled === false);

  // 8. Pay via eSewa (sandbox mockApprove).
  const payResult = await verifyEsewa(booking.id, true);
  check("eSewa verify succeeded", payResult?.ok !== false, JSON.stringify(payResult).slice(0, 80));

  // 9. Re-read booking + ledger; assert the money moved.
  const afterBooking = await fetchBooking(booking.id, user.id);
  check("booking paidAmount now > 0", afterBooking.paidAmount > 0, `paid=${afterBooking.paidAmount}`);
  check(
    "booking paymentStatus is paid",
    afterBooking.paymentStatus === "paid" || afterBooking.paymentStatus === "overpaid",
    afterBooking.paymentStatus,
  );

  const after = await fetchLedger(booking.id);
  check("ledger balance is 0 after payment", after.totals.balance === 0, `balance=${after.totals.balance}`);
  check("ledger has a payment row", after.payments.length >= 1, `${after.payments.length} rows`);
  check(
    "ledger payment source is gateway",
    after.payments.some((p) => p.source === "gateway"),
    after.payments.map((p) => p.source).join(","),
  );

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\nSMOKE TEST ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
