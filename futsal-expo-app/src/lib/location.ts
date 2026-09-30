/**
 * Where tapping a venue's location should go.
 *
 * The owner can paste a Google Maps link in the Venue tab (the "share" sheet in
 * the Maps app hands out exactly that), and that link wins. Without one the app
 * falls back to a Maps search on the venue's address, so a location is tappable
 * whether or not the owner filled the box in.
 */
export function mapsUrl(
  locationUrl?: string | null,
  address?: string | null,
  city?: string | null,
): string | null {
  const pasted = (locationUrl ?? "").trim();

  if (pasted !== "") {
    // Owners paste bare "maps.app.goo.gl/…" as often as a full URL.
    return /^https?:\/\//i.test(pasted) ? pasted : `https://${pasted}`;
  }

  const query = [address, city]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(", ");

  return query === "" ? null : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The name shown on the tappable location row. */
export function locationLabel(
  locationUrl?: string | null,
  address?: string | null,
  city?: string | null,
): string | null {
  const place = [address, city]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(", ");

  if (place !== "") return place;

  // No street address, but the owner pasted a link: still worth tapping.
  return (locationUrl ?? "").trim() !== "" ? "Open in Maps" : null;
}
