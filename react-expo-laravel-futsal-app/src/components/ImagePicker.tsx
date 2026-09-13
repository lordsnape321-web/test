"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Link as LinkIcon, Check } from "lucide-react";
import { VENUE_IMAGES } from "@/lib/futsal";

export const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;

export function ImagePicker({
  value,
  onChange,
  label = "Photo",
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
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
      setError("Please choose a photo (JPG/PNG).");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Over 2.5MB — please use a smaller photo.");
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
      setError("Couldn't read that file.");
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </span>
      {value && (
        <div className="mb-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <img src={value} alt="Preview" className="h-32 w-full object-cover" />
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 py-2.5 text-xs font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {busy ? "Reading…" : value ? "Change photo 📸" : "Upload photo 📸"}
        </button>
        <button
          type="button"
          onClick={() => setUrlMode((v) => !v)}
          title="Paste image link"
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400"
        >
          <LinkIcon className="h-4 w-4" />
        </button>
      </div>
      {urlMode && (
        <div className="mt-2 flex gap-2">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="button"
            onClick={() => {
              if (urlDraft.trim()) {
                onChange(urlDraft.trim());
                setUrlDraft("");
                setUrlMode(false);
              }
            }}
            className="rounded-xl bg-slate-900 px-3.5 text-xs font-black text-white dark:bg-white dark:text-slate-900"
          >
            Use
          </button>
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] font-bold text-red-500">{error}</p>}
      <p className="mt-2 text-[11px] font-bold text-slate-400">…or pick a vibe ✨</p>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        {VENUE_IMAGES.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => onChange(u)}
            className={`relative h-12 overflow-hidden rounded-lg border-2 transition ${
              value === u ? "border-emerald-500" : "border-transparent opacity-80 hover:opacity-100"
            }`}
          >
            <img src={u} alt="" className="h-full w-full object-cover" />
            {value === u && (
              <span className="absolute inset-0 grid place-items-center bg-emerald-600/40">
                <Check className="h-4 w-4 text-white" strokeWidth={3} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
