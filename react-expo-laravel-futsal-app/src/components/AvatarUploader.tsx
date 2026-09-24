"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, Link as LinkIcon } from "lucide-react";
import { initials } from "@/lib/futsal";

export const MAX_AVATAR_BYTES = 2.5 * 1024 * 1024;

export function AvatarUploader({
  name,
  color,
  value,
  onChange,
}: {
  name: string;
  color: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urlMode, setUrlMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  function pickFile(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose a photo (JPG/PNG) 📸");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Over 2.5MB — use a smaller selfie 📸");
      return;
    }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      setBusy(false);
      onChange(String(reader.result ?? ""));
    };
    reader.onerror = () => {
      setBusy(false);
      setError("Couldn't read that photo — try another 📸");
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="Upload profile photo"
        className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-3xl text-2xl font-black text-white shadow-lg transition hover:opacity-90"
        style={{ background: color }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Profile" className="h-full w-full object-cover" />
        ) : (
          initials(name || "?")
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover:opacity-100">
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Camera className="h-5 w-5 text-white" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-full bg-stone-900 px-3.5 py-2 text-[11px] font-black text-white transition hover:bg-stone-700 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {busy ? "Reading…" : value ? "Change photo 📸" : "Upload photo 📸"}
          </button>
          <button
            type="button"
            onClick={() => setUrlMode((v) => !v)}
            title="Paste image link"
            className="grid h-[34px] w-[34px] place-items-center rounded-full border border-stone-200 text-stone-500 dark:border-white/10 dark:text-slate-400"
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              title="Remove photo"
              className="grid h-[34px] w-[34px] place-items-center rounded-full border border-red-200 bg-red-50 text-red-500 dark:border-red-500/30 dark:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-stone-400 dark:text-slate-500">
          JPG/PNG up to 2.5MB — teammates see this everywhere ⚽
        </p>
        {urlMode && (
          <div className="mt-2 flex gap-2">
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold focus:border-stone-900 focus:outline-none dark:border-white/10 dark:bg-white/5"
            />
            <button
              type="button"
              onClick={() => {
                if (!urlDraft.trim()) return;
                if (!/^https?:\/\/.+\..+/.test(urlDraft.trim())) {
                  setError("Paste a valid https image link 🔗");
                  return;
                }
                onChange(urlDraft.trim());
                setUrlDraft("");
                setUrlMode(false);
                setError("");
              }}
              className="shrink-0 rounded-xl bg-stone-900 px-3.5 text-xs font-black text-white dark:bg-white dark:text-slate-900"
            >
              Use
            </button>
          </div>
        )}
        {error && <p className="mt-1.5 text-[11px] font-bold text-red-500">{error}</p>}
      </div>
    </div>
  );
}
