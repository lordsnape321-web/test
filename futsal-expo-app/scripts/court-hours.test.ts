const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
  },
};
import { courtHours, courtTimeSlots } from "../src/lib/futsal";

const venue = { openingHour: 6, closingHour: 22 };

// A court with no hours of its own keeps the venue's — the behaviour every
// court had before per-court hours existed.
assert.deepEqual(courtHours(null, venue), { opensAt: "06:00", closesAt: "22:00", inherited: true });
assert.deepEqual(courtHours({ opensAt: null, closesAt: null }, venue), {
  opensAt: "06:00",
  closesAt: "22:00",
  inherited: true,
});
assert.deepEqual(courtTimeSlots(undefined, venue).slice(0, 2), ["06:00", "07:00"]);
assert.equal(courtTimeSlots(undefined, venue).length, 16);
assert.equal(courtTimeSlots(undefined, venue).at(-1), "21:00");

// A court's own window wins, and the slot list stops one hour before closing.
assert.deepEqual(courtHours({ opensAt: "05:00", closesAt: "23:00" }, venue), {
  opensAt: "05:00",
  closesAt: "23:00",
  inherited: false,
});
assert.deepEqual(courtTimeSlots({ opensAt: "05:00", closesAt: "23:00" }, venue).slice(0, 2), [
  "05:00",
  "06:00",
]);
assert.equal(courtTimeSlots({ opensAt: "05:00", closesAt: "23:00" }, venue).at(-1), "22:00");

// Half-hour openings shift the whole list instead of dropping the first slot.
assert.deepEqual(courtTimeSlots({ opensAt: "06:30", closesAt: "09:30" }, venue), [
  "06:30",
  "07:30",
  "08:30",
]);

// A venue that carries no hours at all still books 6–22 rather than nothing.
assert.equal(courtTimeSlots(null, { openingHour: null, closingHour: null }).length, 16);
assert.equal(courtTimeSlots(null, null).at(0), "06:00");

// Strings coming out of JSON behave exactly like numbers.
assert.equal(
  courtHours(null, { openingHour: "7", closingHour: "21" }).opensAt,
  "07:00",
);

// One hour without the other means "follow the venue", the same rule the API
// enforces, so a half-filled form can never produce a half-open court.
assert.equal(courtHours({ opensAt: "05:00", closesAt: null }, venue).inherited, true);
assert.equal(courtHours({ opensAt: "05:00", closesAt: null }, venue).opensAt, "06:00");

console.log("court-hours: all assertions passed");
