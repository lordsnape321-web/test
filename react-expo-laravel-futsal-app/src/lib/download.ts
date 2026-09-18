/**
 * Saving things to the phone 💾
 *
 * Photos in an album are stored as data URLs on the league row (the same trick
 * the receipt uploader uses), so there is no file on a server to point a link
 * at — the bytes are already in the browser. Everything here runs client-side.
 *
 * One photo is an anchor with `download` on it. A whole album is a ZIP, built
 * here rather than pulled in as a dependency: the photos are already-compressed
 * JPEGs, so a *stored* (uncompressed) ZIP loses nothing and is a few dozen lines
 * of header-writing. It also beats firing twenty anchors at once, which Chrome
 * quietly blocks after the first couple.
 */

/* ------------------------------------------------------------------ basics */

/** "Chabahil Premier League — Season 1" -> "chabahil-premier-league-season-1" */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      // keep letters, numbers and the usual separators; everything else goes
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "download"
  );
}

/** File extension from a mime type, defaulting to jpg because that's what phones shoot. */
export function extForMime(mime: string): string {
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  return known[mime] ?? "jpg";
}

/**
 * Split `data:image/jpeg;base64,/9j/4AAQ…` into its parts.
 * Returns null for anything that isn't a data URL, so callers can fall back to
 * treating it as a plain link.
 */
export function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url.trim());
  if (!m) return null;
  return { mime: (m[1] || "application/octet-stream").trim(), base64: m[3] ?? "" };
}

/** Decode the base64 half of a data URL into bytes. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Bytes + a filename for one photo, from whatever the album stored for it. */
export function photoFile(
  url: string,
  opts: { caption?: string; fallbackName?: string; index?: number } = {}
): { name: string; bytes: Uint8Array<ArrayBuffer>; mime: string } | null {
  const parsed = parseDataUrl(url);
  if (!parsed) return null;
  const bytes = base64ToBytes(parsed.base64);
  const n = typeof opts.index === "number" ? opts.index + 1 : 1;
  const stem = slugify(opts.caption || opts.fallbackName || `photo-${n}`);
  const name = `${String(n).padStart(2, "0")}-${stem}.${extForMime(parsed.mime)}`;
  return { name, bytes, mime: parsed.mime };
}

/* ------------------------------------------------------------- saving a file */

/** Hand a Blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // long enough for the click to be handled, short enough not to leak
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}

/**
 * Save one photo. Data URLs go through a Blob so the browser gets a real file
 * with the right extension; an http(s) link is handed straight to the anchor
 * (the remote server decides whether that's a download or a page).
 */
export async function savePhoto(
  url: string,
  opts: { caption?: string; fallbackName?: string; index?: number } = {}
): Promise<void> {
  const parsed = parseDataUrl(url);
  const n = typeof opts.index === "number" ? opts.index + 1 : 1;
  const stem = slugify(opts.caption || opts.fallbackName || `photo-${n}`);

  if (!parsed) {
    const a = document.createElement("a");
    a.href = url;
    a.download = stem;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  saveBlob(
    new Blob([base64ToBytes(parsed.base64)], { type: parsed.mime }),
    `${String(n).padStart(2, "0")}-${stem}.${extForMime(parsed.mime)}`
  );
}

/* -------------------------------------------------------------- a real ZIP */

let crcTable: Uint32Array | null = null;

/** The standard CRC-32 used by ZIP, built once and cached. */
function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; bytes: Uint8Array<ArrayBuffer> };

/**
 * Build a ZIP with every entry *stored* (no compression).
 *
 * Layout is local header + data per file, then the central directory, then the
 * end-of-central-directory record that points back at it. Sizes are 32-bit, so
 * this is for a few dozen photos, not an archive — which is exactly what an
 * album is.
 */
export function makeZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array<ArrayBuffer> {
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((Math.floor(now.getSeconds() / 2)) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);

  const encoder = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);

  for (const entry of entries) {
    // ASCII-only names keep the header flags at 0 and every unzip tool happy.
    const nameBytes = encoder.encode(entry.name.replace(/[^\x20-\x7e]/g, "-"));
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); // local file header
    u16(lv, 4, 20); // version needed
    u16(lv, 6, 0); // flags
    u16(lv, 8, 0); // method: stored
    u16(lv, 10, dosTime);
    u16(lv, 12, dosDate);
    u32(lv, 14, crc);
    u32(lv, 18, size); // compressed size (same, nothing is compressed)
    u32(lv, 22, size); // uncompressed size
    u16(lv, 26, nameBytes.length);
    u16(lv, 28, 0); // extra field
    local.set(nameBytes, 30);

    chunks.push(local, entry.bytes);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    u32(dv, 0, 0x02014b50); // central directory header
    u16(dv, 4, 20); // version made by
    u16(dv, 6, 20); // version needed
    u16(dv, 8, 0);
    u16(dv, 10, 0);
    u16(dv, 12, dosTime);
    u16(dv, 14, dosDate);
    u32(dv, 16, crc);
    u32(dv, 20, size);
    u32(dv, 24, size);
    u16(dv, 28, nameBytes.length);
    u16(dv, 30, 0);
    u16(dv, 32, 0); // comment
    u16(dv, 34, 0); // disk number
    u16(dv, 36, 0); // internal attributes
    u32(dv, 38, 0); // external attributes
    u32(dv, 42, offset); // where this file's local header sits
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); // end of central directory
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);
  u16(ev, 20, 0);

  let total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, at);
    at += c.length;
  }
  total = at;
  return out.subarray(0, total);
}

/** Save a list of files as one ZIP download. */
export function saveZip(filename: string, entries: ZipEntry[]): number {
  const zip = makeZip(entries);
  saveBlob(
    new Blob([zip], { type: "application/zip" }),
    filename.endsWith(".zip") ? filename : `${slugify(filename)}.zip`
  );
  return entries.length;
}
