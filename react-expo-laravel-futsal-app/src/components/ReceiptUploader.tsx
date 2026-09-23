"use client";

import { useRef, useState } from "react";
import { ReceiptText, Upload, X, Eye, Loader2 } from "lucide-react";

export const ONLINE_METHODS = ["eSewa", "Khalti"];
export const MAX_RECEIPT_BYTES = 2.5 * 1024 * 1024;

export function isOnlineMethod(method: string) {
  return ONLINE_METHODS.includes(method);
}

export function ReceiptUploader({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);

  function pickFile(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload a screenshot or photo (JPG/PNG).");
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      setError("That file is over 2.5MB — please use a smaller screenshot.");
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
      setError("Couldn't read that file — try another one.");
    };
    reader.readAsDataURL(file);
  }

  if (value) {
    return (
      <div>
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-50 p-2.5 dark:bg-emerald-500/10">
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl"
          >
            <img src={value} alt="Receipt" className="h-full w-full object-cover" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-black text-emerald-700 dark:text-emerald-300">
              <ReceiptText className="h-3.5 w-3.5" /> Receipt attached ✓
            </p>
            <p className="text-[11px] text-stone-500 dark:text-slate-400">
              The venue can see this for fast approval.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPreview(true)}
            title="View"
            className="grid h-9 w-9 place-items-center rounded-xl bg-white text-stone-600 shadow-sm dark:bg-white/10 dark:text-slate-300"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onChange("")}
            title="Remove"
            className="grid h-9 w-9 place-items-center rounded-xl bg-white text-red-500 shadow-sm dark:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {preview && (
          <ReceiptViewer url={value} onClose={() => setPreview(false)} />
        )}
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={`flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50 font-black text-orange-700 transition hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300 dark:hover:bg-orange-500/15 ${
          compact ? "py-2.5 text-xs" : "py-3.5 text-sm"
        }`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {busy ? "Reading…" : "Upload payment screenshot 🧾"}
      </button>
      {error && (
        <p className="mt-1.5 text-[11px] font-bold text-red-500">{error}</p>
      )}
      {!compact && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400 dark:text-slate-500">
          Paid online? Snap your eSewa / Khalti confirmation — venues
          approve receipt-backed requests way faster. ⚡
        </p>
      )}
    </div>
  );
}

export function ReceiptViewer({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-black text-stone-900 dark:text-slate-100">
            <ReceiptText className="h-4 w-4 text-emerald-600" /> Payment receipt
          </p>
          <button
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-stone-600 dark:bg-white/10 dark:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <img src={url} alt="Payment receipt" className="max-h-[70vh] w-full object-contain bg-stone-100 dark:bg-black" />
      </div>
    </div>
  );
}
