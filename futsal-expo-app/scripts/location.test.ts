const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  },
};
import { locationLabel, mapsUrl } from "../src/lib/location";

// The owner's pasted link wins, and a bare share link is made absolute.
assert.equal(
  mapsUrl("https://maps.app.goo.gl/abc123", "Baneshwor", "Kathmandu"),
  "https://maps.app.goo.gl/abc123",
);
assert.equal(
  mapsUrl("maps.app.goo.gl/abc123", "Baneshwor", "Kathmandu"),
  "https://maps.app.goo.gl/abc123",
);

// Without one, a Maps search on the address — spaces and commas encoded.
assert.equal(
  mapsUrl("", "Baneshwor Height, Kathmandu", "Kathmandu"),
  "https://www.google.com/maps/search/?api=1&query=Baneshwor%20Height%2C%20Kathmandu%2C%20Kathmandu",
);
assert.equal(
  mapsUrl(null, "Baneshwor", ""),
  "https://www.google.com/maps/search/?api=1&query=Baneshwor",
);
assert.equal(mapsUrl("   ", "", "   "), null);
assert.equal(mapsUrl(null, null, null), null);

// What the tappable row says: the address when there is one, otherwise the link.
assert.equal(locationLabel(null, "Baneshwor", "Kathmandu"), "Baneshwor, Kathmandu");
assert.equal(locationLabel("https://maps.app.goo.gl/abc", "", ""), "Open in Maps");
assert.equal(locationLabel(null, "", ""), null);

console.log("location: all assertions passed");
