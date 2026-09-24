"use client";

import { useRef, useState } from "react";
import {
  Camera,
  Download,
  ExternalLink,
  ImagePlus,
  Link as LinkIcon,
  Loader2,
  Lock,
  Trash2,
  X,
} from "lucide-react";
import type { LeagueDetail, LeagueMediaRow } from "@/lib/league-store";
import { MAX_IMAGE_BYTES } from "./ImagePicker";
import { validateExternalUrl } from "@/lib/validation";
import { photoFile, savePhoto, saveZip, type ZipEntry } from "@/lib/download";
import { timeAgo } from "./NotificationBell";
import { apiFetch } from "@/lib/api";

/**
 * The album 📸
 *
 * Two ways in, because two ways is what a host actually has: pick a photo off
 * the phone (stored as a data URL, the same trick the receipt uploader uses — no
 * storage service needed) or paste a link to the Drive/Facebook album they
 * already keep.
 *
 * Who can *see* it is decided on the server, not here: the host plus the squads
 * in the league for a league-wide photo, and only the two squads that played a
 * fixture for that fixture's photos. The lock line under each photo says which
 * of the two it is, so nobody has to guess why a teammate can't see a picture.
 */
export function LeagueAlbum({
  league,
  hostId,
  isHost,
  focusMatchId,
  onChanged,
}: {
  league: LeagueDetail;
  hostId: number;
  isHost: boolean;
  focusMatchId?: number | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"file" | "link">("link");
  const [linkUrl, setLinkUrl] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [matchId, setMatchId] = useState<string>(focusMatchId ? String(focusMatchId) : "");
  const [preview, setPreview] = useState<LeagueMediaRow | null>(null);
  const [zipping, setZipping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const photos = league.media.filter((m) => m.kind === "file");
  const links = league.media.filter((m) => m.kind === "link");
  const playedMatches = league.matches.filter((m) => m.status === "played");

  /**
   * The whole album as one .zip 📦
   *
   * One file per photo, named after its caption, plus a text file of the album
   * links when the host pasted any — those live on Drive, so the most this can
   * do is write the addresses down.
   */
  function downloadAll() {
    const entries: ZipEntry[] = [];
    photos.forEach((p, i) => {
      const file = photoFile(p.url, { caption: p.caption, fallbackName: "match-photo", index: i });
      if (file) entries.push(file);
    });
    if (links.length > 0) {
      const text = links
        .map((l) => `${l.caption ? `${l.caption} — ` : ""}${l.url}`)
        .join("\n");
      entries.push({
        name: "album-links.txt",
        bytes: new TextEncoder().encode(`${text}\n`),
      });
    }
    if (entries.length === 0) {
      setErr("There's nothing here to save yet 📭");
      return;
    }
    setZipping(true);
    setErr("");
    try {
      const count = saveZip(`${league.name} — album`, entries);
      setMsg(`Saved ${count} file${count === 1 ? "" : "s"} to your downloads 📦`);
    } catch {
      setErr("That album wouldn't save — try the photos one at a time 🙏");
    } finally {
      setZipping(false);
    }
  }

  function pickFile(file: File | undefined) {
    setErr("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Please choose a photo (JPG/PNG) 📸");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setErr("That photo is over 2.5MB — use a smaller one, or paste a Drive link instead 🔗");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFileUrl(String(reader.result ?? ""));
    reader.onerror = () => setErr("Couldn't read that file — try another one.");
    reader.readAsDataURL(file);
  }

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg("");
    setErr("");
    try {
      const res = await apiFetch(`/api/tournaments/${league.id}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: hostId, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "That didn't work 🙏"));
      setMsg(String(data.message ?? "Added 📸"));
      setLinkUrl("");
      setFileUrl("");
      setCaption("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  return (
    <div id="album" className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          <Camera className="h-3.5 w-3.5" /> Match photos
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-black text-stone-500 dark:bg-white/10 dark:text-slate-300">
            {league.media.length}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {photos.length + links.length > 0 && (
            <button
              onClick={downloadAll}
              disabled={zipping}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-300 px-3 py-1.5 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
            >
              {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download all{photos.length > 0 ? ` (${photos.length})` : ""}
            </button>
          )}
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
            <Lock className="h-3 w-3" /> Host + the squads involved only
          </p>
        </div>
      </div>

      {(msg || err) && (
        <p
          className={`mt-3 rounded-2xl px-4 py-2.5 text-xs font-bold ${
            err
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          }`}
        >
          {err || msg}
        </p>
      )}

      {isHost && (
        <div className="mt-3 rounded-2xl border border-dashed border-emerald-300 p-3.5 dark:border-emerald-500/30">
          <div className="flex gap-1.5">
            {(["link", "file"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black transition ${
                  tab === t
                    ? "bg-emerald-600 text-white"
                    : "border border-stone-200 text-stone-600 dark:border-white/10 dark:text-slate-300"
                }`}
              >
                {t === "link" ? <LinkIcon className="h-3 w-3" /> : <ImagePlus className="h-3 w-3" />}
                {t === "link" ? "Paste an album link" : "Upload a photo"}
              </button>
            ))}
          </div>

          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {tab === "link" ? (
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://drive.google.com/… or a Facebook album"
                className="rounded-xl border border-[#F0E3CC] bg-[#FFFDF7] px-3 py-2 text-xs font-semibold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
              />
            ) : (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#F0E3CC] bg-[#FFFDF7] px-3 py-2 text-xs font-black text-stone-700 transition hover:bg-stone-50 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200"
                >
                  {fileUrl ? "Change photo ✓" : "Choose a photo from this device"}
                </button>
              </div>
            )}
            <select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              className="rounded-xl border border-[#F0E3CC] bg-[#FFFDF7] px-3 py-2 text-xs font-bold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">Whole league (every squad in it)</option>
              {playedMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.round}: {m.homeTeamName} {m.homeScore}–{m.awayScore} {m.awayTeamName}
                </option>
              ))}
            </select>
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption (optional)"
              maxLength={160}
              className="rounded-xl border border-[#F0E3CC] bg-[#FFFDF7] px-3 py-2 text-xs font-semibold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            />
            <button
              onClick={() => {
                const url = tab === "link" ? linkUrl.trim() : fileUrl;
                const linkErr = tab === "link" ? validateExternalUrl(url) : null;
                if (linkErr) {
                  setErr(linkErr);
                  return;
                }
                if (tab === "file" && !url) {
                  setErr("Choose a photo first 📸");
                  return;
                }
                void post(
                  { action: "add", kind: tab, url, caption, matchId: matchId ? Number(matchId) : null },
                  "add"
                );
              }}
              disabled={busy !== ""}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2.5 text-xs font-black text-white transition hover:bg-stone-800 disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              Add to the album
            </button>
          </div>
        </div>
      )}

      {league.media.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-xs font-bold text-stone-400 dark:border-white/10 dark:text-slate-500">
          No photos yet.{" "}
          {isHost
            ? "Upload the tournament photos, or paste the Drive link you already share with the squads."
            : "The host will post photos here after each round."}
        </p>
      ) : (
        <>
          {photos.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {photos.map((p, i) => (
                <div key={p.id} className="group relative">
                  <button
                    onClick={() => setPreview(p)}
                    className="relative block w-full overflow-hidden rounded-2xl border border-[#F0E3CC] dark:border-white/10"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URLs from the host's device */}
                    <img src={p.url} alt={p.caption || "Match photo"} className="h-32 w-full object-cover transition group-hover:scale-105" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-left">
                      <span className="block truncate text-[10px] font-black text-white">
                        {p.caption || "Match photo"}
                      </span>
                      <span className="block truncate text-[9px] font-bold text-white/70">{p.scope}</span>
                    </span>
                  </button>
                  {/* Sits over the tile rather than inside it — a button inside a
                      button is invalid, and this one has to save, not preview. */}
                  <button
                    onClick={() => void savePhoto(p.url, { caption: p.caption, fallbackName: "match-photo", index: i })}
                    title="Download this photo"
                    className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition hover:bg-emerald-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {links.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {links.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#FFF6E9] px-3.5 py-2.5 dark:bg-white/5"
                >
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 items-center gap-2 text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300"
                  >
                    <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{l.caption || l.url}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                  </a>
                  <span className="flex items-center gap-2 text-[10px] font-bold text-stone-400 dark:text-slate-500">
                    <span className="flex items-center gap-1">
                      <Lock className="h-3 w-3" /> {l.scope}
                    </span>
                    <span>{l.createdAt ? timeAgo(l.createdAt) : ""}</span>
                    {isHost && (
                      <button
                        onClick={() => void post({ action: "delete", mediaId: l.id }, `del-${l.id}`)}
                        disabled={busy !== ""}
                        className="rounded-lg border border-stone-200 p-1 text-stone-400 transition hover:text-red-500 dark:border-white/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-stone-900 dark:text-slate-100">
                  {preview.caption || "Match photo"}
                </p>
                <p className="truncate text-[11px] font-bold text-stone-400 dark:text-slate-500">
                  {preview.scope} • {preview.credit || preview.uploaderName}
                </p>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-600 dark:bg-white/10 dark:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img src={preview.url} alt={preview.caption} className="max-h-[70vh] w-full bg-stone-100 object-contain dark:bg-black" />
            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
              {/* Anyone who can see the album can keep a copy — that's the point
                  of posting match photos. */}
              <button
                onClick={() =>
                  void savePhoto(preview.url, {
                    caption: preview.caption,
                    fallbackName: "match-photo",
                    index: photos.indexOf(preview),
                  })
                }
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-[11px] font-black text-white transition hover:bg-emerald-700"
              >
                <Download className="h-3.5 w-3.5" /> Download photo
              </button>
              {isHost && (
                <button
                  onClick={() => {
                    void post({ action: "delete", mediaId: preview.id }, `del-${preview.id}`);
                    setPreview(null);
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3.5 py-2 text-[11px] font-black text-red-500 dark:border-red-500/30"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove photo
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
