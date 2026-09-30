/**
 * Image URLs, sized to where they are going.
 *
 * Venue photos are Unsplash URLs stored at `w=1200` — a good size for a hero,
 * and about six times the pixels a 192px-tall card can show. On a phone that is
 * the difference between the venue list appearing and the venue list *filling
 * in* slowly, and it is real data over a real connection, so unlike most of the
 * performance work it also matters in production.
 *
 * Unsplash resizes on its own CDN, so asking for the size we actually need
 * costs nothing and saves most of the bytes. Anything that is not an Unsplash
 * URL is returned untouched: the app must never break a link it does not
 * understand to save a few kilobytes.
 */

/** The width a card image is displayed at, doubled for high-density screens. */
export const CARD_IMAGE_WIDTH = 720;

/** Full-bleed heroes. */
export const HERO_IMAGE_WIDTH = 1200;

/**
 * Rewrite an Unsplash URL to the given width.
 *
 * @param url  the stored image URL (may be null — venues often have none)
 * @param width target width in pixels; the height follows the source ratio
 */
export function sizedImage(url: string | null | undefined, width: number): string {
  const trimmed = (url ?? "").trim();

  if (trimmed === "") return "";

  // Only Unsplash: its `w`/`q` parameters are an image API. A venue that pasted
  // its own photo host must get the URL it pasted.
  if (!/^https?:\/\/images\.unsplash\.com\//i.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const current = Number(parsed.searchParams.get("w") ?? "0");

    // Never upscale: a 400px source stays 400px.
    if (current > 0 && current <= width) return trimmed;

    parsed.searchParams.set("w", String(width));
    if (!parsed.searchParams.has("q")) parsed.searchParams.set("q", "80");
    if (!parsed.searchParams.has("auto")) parsed.searchParams.set("auto", "format");

    return parsed.toString();
  } catch {
    return trimmed;
  }
}
