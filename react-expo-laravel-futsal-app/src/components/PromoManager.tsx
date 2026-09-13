"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Dice5,
  Eye,
  EyeOff,
  IndianRupee,
  Pause,
  Pencil,
  Percent,
  Play,
  Plus,
  Sparkles,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";
import { formatNPR, todayISO } from "@/lib/futsal";
import { normalizePromoCode, promoDiscountFor, suggestPromoCode } from "@/lib/promos";
import {
  firstError,
  validateDiscountValue,
  validateMaxDiscount,
  validateMinBookingAmount,
  validatePromoCode,
  validatePromoTitle,
  validatePromoWindow,
  validateUsageLimit,
} from "@/lib/validation";

type Promo = {
  id: number;
  venueId: number;
  code: string;
  title: string;
  discountType: string;
  discountValue: number;
  maxDiscount: number;
  minBookingAmount: number;
  startsAt: string | null;
  expiresAt: string;
  usageLimit: number;
  perUserLimit: number;
  isPublic: boolean;
  isActive: boolean;
  summary: string;
  expiryLabel: string;
  expiresOn: string;
  startsOn: string;
  state: "live" | "upcoming" | "expired" | "paused";
  stateLabel: string;
  stateEmoji: string;
  live: boolean;
  usedCount: number;
  remaining: number | null;
  discountGiven: number;
};

/** One-tap starters — owners can adjust every field afterwards. */
const PRESETS: Array<{
  name: string;
  emoji: string;
  hint: string;
  fill: {
    code: string;
    title: string;
    discountType: "percent" | "flat";
    discountValue: number;
    maxDiscount: number;
    minBookingAmount: number;
    days: number;
    usageLimit: number;
    perUserLimit: number;
  };
}> = [
  {
    name: "Weekday boost",
    emoji: "📅",
    hint: "10% off, 14 days",
    fill: { code: "WEEKDAY10", title: "Weekday boost", discountType: "percent", discountValue: 10, maxDiscount: 0, minBookingAmount: 0, days: 14, usageLimit: 0, perUserLimit: 1 },
  },
  {
    name: "Festival offer",
    emoji: "🎉",
    hint: "20% off, capped at Rs. 500",
    fill: { code: "FESTIVE20", title: "Festival offer", discountType: "percent", discountValue: 20, maxDiscount: 500, minBookingAmount: 2000, days: 30, usageLimit: 50, perUserLimit: 1 },
  },
  {
    name: "Flat rupees off",
    emoji: "💸",
    hint: "Rs. 300 off, 7 days",
    fill: { code: "SAVE300", title: "Rs. 300 off", discountType: "flat", discountValue: 300, maxDiscount: 0, minBookingAmount: 1500, days: 7, usageLimit: 25, perUserLimit: 1 },
  },
];

const STATE_STYLE: Record<Promo["state"], string> = {
  live: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  upcoming: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  expired: "bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
};

export function PromoManager({
  venue,
  ownerId,
  samplePrice = 1500,
}: {
  venue: { id: number; name: string } | null;
  ownerId: number;
  samplePrice?: number;
}) {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promo | null>(null);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");
  const [discountValue, setDiscountValue] = useState(10);
  const [maxDiscount, setMaxDiscount] = useState(0);
  const [minBookingAmount, setMinBookingAmount] = useState(0);
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => todayISO(30));
  const [usageLimit, setUsageLimit] = useState(0);
  const [perUserLimit, setPerUserLimit] = useState(1);
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const venueId = venue?.id ?? 0;

  const load = useCallback(async () => {
    if (!venueId) return;
    try {
      const res = await fetch(`/api/promos?ownerId=${ownerId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load promo codes");
      setPromos(
        ((data.promos ?? []) as Promo[]).filter((p) => p.venueId === venueId)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load promo codes 🙏");
    } finally {
      setLoading(false);
    }
  }, [venueId, ownerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch this venue's codes on mount / venue switch
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const live = promos.filter((p) => p.live);
    return {
      live: live.length,
      used: promos.reduce((s, p) => s + p.usedCount, 0),
      given: promos.reduce((s, p) => s + p.discountGiven, 0),
      expiringSoon: live.filter((p) => p.expiresAt <= todayISO(7)).length,
    };
  }, [promos]);

  function resetForm() {
    setEditing(null);
    setCode("");
    setTitle("");
    setDiscountType("percent");
    setDiscountValue(10);
    setMaxDiscount(0);
    setMinBookingAmount(0);
    setStartsAt("");
    setExpiresAt(todayISO(30));
    setUsageLimit(0);
    setPerUserLimit(1);
    setIsPublic(true);
    setFormError("");
  }

  function openCreate(preset?: (typeof PRESETS)[number]) {
    resetForm();
    if (preset) {
      const f = preset.fill;
      setCode(f.code);
      setTitle(f.title);
      setDiscountType(f.discountType);
      setDiscountValue(f.discountValue);
      setMaxDiscount(f.maxDiscount);
      setMinBookingAmount(f.minBookingAmount);
      setExpiresAt(todayISO(f.days));
      setUsageLimit(f.usageLimit);
      setPerUserLimit(f.perUserLimit);
    }
    setShowForm(true);
  }

  function openEdit(p: Promo) {
    setEditing(p);
    setCode(p.code);
    setTitle(p.title);
    setDiscountType(p.discountType === "flat" ? "flat" : "percent");
    setDiscountValue(p.discountValue);
    setMaxDiscount(p.maxDiscount);
    setMinBookingAmount(p.minBookingAmount);
    setStartsAt(p.startsAt ?? "");
    // An already-expired code can only be saved with a fresh expiry date.
    setExpiresAt(p.expiresAt < todayISO() ? todayISO(30) : p.expiresAt);
    setUsageLimit(p.usageLimit);
    setPerUserLimit(p.perUserLimit);
    setIsPublic(p.isPublic);
    setFormError("");
    setShowForm(true);
  }

  /** What a player would pay on a sample bill — shown live while typing. */
  const preview = useMemo(() => {
    const bill = Math.max(0, Math.round(Number(samplePrice) || 0) * 2);
    if (bill <= 0) return null;
    const value = Number(discountValue) || 0;
    const d = promoDiscountFor(
      {
        code,
        discountType,
        discountValue: value,
        maxDiscount: discountType === "percent" ? maxDiscount : 0,
        minBookingAmount,
        expiresAt,
      },
      bill
    );
    return { bill, discount: d.amount, payable: d.payable, belowMin: minBookingAmount > bill };
  }, [samplePrice, discountType, discountValue, maxDiscount, minBookingAmount, expiresAt, code]);

  async function save() {
    if (!venue) return;
    const cleanCode = normalizePromoCode(code);
    const err = firstError(
      validatePromoCode(cleanCode),
      title.trim() ? validatePromoTitle(title) : null,
      validateDiscountValue(discountValue, discountType),
      discountType === "percent" ? validateMaxDiscount(maxDiscount) : null,
      validateMinBookingAmount(minBookingAmount),
      validateUsageLimit(usageLimit, "Total redemption limit"),
      validateUsageLimit(perUserLimit, "Per-player limit"),
      validatePromoWindow(startsAt, expiresAt)
    );
    if (err) {
      setFormError(err);
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        ownerId,
        code: cleanCode,
        title: title.trim(),
        discountType,
        discountValue,
        maxDiscount: discountType === "percent" ? maxDiscount : 0,
        minBookingAmount,
        startsAt: startsAt || "",
        expiresAt,
        usageLimit,
        perUserLimit,
        isPublic,
      };
      const res = await fetch(editing ? `/api/promos/${editing.id}` : "/api/promos", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? payload : { venueId: venue.id, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save the promo code");
      setShowForm(false);
      resetForm();
      setNotice(
        editing
          ? `${cleanCode} updated ✨`
          : `${cleanCode} is live 🎉 Players can use it until ${new Date(`${expiresAt}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
      );
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save the promo code 🙏");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Promo) {
    setBusy(p.id);
    setError("");
    try {
      const res = await fetch(`/api/promos/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, isActive: !p.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update");
      setNotice(p.isActive ? `${p.code} paused ⏸️` : `${p.code} is live again 🟢`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update 🙏");
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Promo) {
    if (!confirm(`Delete ${p.code}? Players won't be able to use it any more.`)) return;
    setBusy(p.id);
    setError("");
    try {
      const res = await fetch(`/api/promos/${p.id}?ownerId=${ownerId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Already-redeemed codes are paused instead of deleted.
        setNotice(data.error || "Couldn't delete 🙏");
      } else {
        setNotice(`${p.code} deleted 🗑️`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete 🙏");
    } finally {
      setBusy(null);
    }
  }

  async function copyCode(p: Promo) {
    try {
      await navigator.clipboard.writeText(p.code);
      setCopied(p.code);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:focus:border-white [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100";
  const labelCls =
    "mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500";

  if (!venue) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Live codes", value: stats.live, emoji: "🟢" },
            { label: "Redeemed", value: stats.used, emoji: "🎟️" },
            { label: "Discount given", value: formatNPR(stats.given), emoji: "💸" },
            { label: "Ending ≤7 days", value: stats.expiringSoon, emoji: "⏳" },
          ].map((s) => (
            <span
              key={s.label}
              className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] font-black text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400"
            >
              {s.emoji} {s.label}:{" "}
              <span className="text-slate-900 dark:text-slate-100">{s.value}</span>
            </span>
          ))}
        </div>
        <button
          onClick={() => openCreate()}
          className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={3} /> New promo code
        </button>
      </div>

      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-xs font-bold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      ) : promos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <Ticket className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 text-base font-extrabold">No promo codes yet 🎟️</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Create a code with an expiry date — players type it at checkout and pay less.
            Empty weekday slots? A code fills them.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => openCreate(p)}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-[11px] font-bold text-slate-600 transition hover:border-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-white"
              >
                <span className="block font-black text-slate-900 dark:text-slate-100">
                  {p.emoji} {p.name}
                </span>
                {p.hint}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {promos.map((p) => (
            <div
              key={p.id}
              className={`rounded-xl border p-3.5 ${
                p.live
                  ? "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40"
                  : "border-slate-100 bg-slate-50 opacity-75 dark:border-slate-800 dark:bg-slate-800/60"
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow">
                  {p.discountType === "flat" ? (
                    <IndianRupee className="h-5 w-5" strokeWidth={2.5} />
                  ) : (
                    <Percent className="h-5 w-5" strokeWidth={2.5} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => copyCode(p)}
                      title="Copy code"
                      className="rounded-lg bg-slate-900 px-2.5 py-1 font-mono text-sm font-black tracking-wide text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900"
                    >
                      {p.code}
                    </button>
                    {copied === p.code && (
                      <span className="text-[11px] font-black text-emerald-600">Copied ✓</span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${STATE_STYLE[p.state]}`}
                    >
                      {p.stateEmoji} {p.stateLabel}
                    </span>
                    {!p.isPublic && (
                      <span className="flex items-center gap-1 rounded-full bg-slate-200 px-2 py-1 text-[10px] font-black text-slate-600 dark:bg-white/10 dark:text-slate-300">
                        <EyeOff className="h-3 w-3" /> Hidden
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[13px] font-extrabold text-slate-800 dark:text-slate-200">
                    {p.summary}
                    {p.title ? <span className="font-semibold text-slate-500"> • {p.title}</span> : null}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {p.startsOn ? `${p.startsOn} → ` : ""}
                      {p.expiresOn} • {p.expiryLabel}
                    </span>
                    <span className="flex items-center gap-1">
                      <Ticket className="h-3.5 w-3.5" />
                      {p.usedCount}
                      {p.usageLimit > 0 ? `/${p.usageLimit}` : ""} used
                      {p.remaining !== null ? ` • ${p.remaining} left` : " • unlimited"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {p.perUserLimit > 0 ? `${p.perUserLimit} per player` : "unlimited per player"}
                    </span>
                    {p.minBookingAmount > 0 && <span>Min booking {formatNPR(p.minBookingAmount)}</span>}
                    {p.discountGiven > 0 && <span>Given away {formatNPR(p.discountGiven)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => toggleActive(p)}
                    disabled={busy === p.id}
                    title={p.isActive ? "Pause this code" : "Make it live again"}
                    className={`grid h-9 w-9 place-items-center rounded-xl transition disabled:opacity-40 ${
                      p.isActive
                        ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300"
                    }`}
                  >
                    {p.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    disabled={busy === p.id}
                    title="Edit code, discount or expiry"
                    className="grid h-9 w-9 place-items-center rounded-xl bg-slate-200 text-slate-700 transition hover:bg-slate-300 disabled:opacity-40 dark:bg-white/10 dark:text-slate-200"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(p)}
                    disabled={busy === p.id}
                    title="Delete code"
                    className="grid h-9 w-9 place-items-center rounded-xl bg-red-100 text-red-600 transition hover:bg-red-200 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit */}
      {showForm && (
        <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-900/50 p-4">
          <div className="my-6 w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-lg font-black">
              <Sparkles className="h-5 w-5 text-amber-500" />
              {editing ? `Edit ${editing.code} ✏️` : "New promo code 🎟️"}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              at {venue.name} — players type the code at checkout.
            </p>

            <div className="mt-4 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
              {!editing && (
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => {
                        const f = p.fill;
                        setCode(f.code);
                        setTitle(f.title);
                        setDiscountType(f.discountType);
                        setDiscountValue(f.discountValue);
                        setMaxDiscount(f.maxDiscount);
                        setMinBookingAmount(f.minBookingAmount);
                        setExpiresAt(todayISO(f.days));
                        setUsageLimit(f.usageLimit);
                        setPerUserLimit(f.perUserLimit);
                        setFormError("");
                      }}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-black text-slate-500 transition hover:border-slate-900 dark:border-slate-700 dark:text-slate-400"
                    >
                      {p.emoji} {p.name}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <span className={labelCls}>Promo code *</span>
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(normalizePromoCode(e.target.value))}
                    placeholder="e.g. SAVE10"
                    maxLength={24}
                    autoCapitalize="characters"
                    spellCheck={false}
                    className={`${inputCls} font-mono uppercase tracking-wider`}
                  />
                  <button
                    type="button"
                    onClick={() => setCode(suggestPromoCode(title || venue.name))}
                    title="Suggest a code"
                    className="grid w-12 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-slate-900 dark:border-slate-700 dark:text-slate-400"
                  >
                    <Dice5 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Letters, numbers and dashes — saved uppercase, {code.trim().length}/24.
                </p>
              </div>

              <div>
                <span className={labelCls}>Offer name (optional, shown to you + players)</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Weekend early-bird"
                  maxLength={60}
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelCls}>Discount type</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["percent", "flat"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setDiscountType(t)}
                        className={`rounded-xl border px-2 py-2.5 text-xs font-black transition ${
                          discountType === t
                            ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                            : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400"
                        }`}
                      >
                        {t === "percent" ? "% off" : "Rs. off"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className={labelCls}>
                    {discountType === "percent" ? "Percent off *" : "Rupees off *"}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={discountType === "percent" ? 100 : 100000}
                    step={1}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
                {discountType === "percent" && (
                  <div>
                    <span className={labelCls}>Max discount cap (0 = no cap)</span>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={maxDiscount}
                      onChange={(e) => setMaxDiscount(Number(e.target.value))}
                      className={inputCls}
                    />
                  </div>
                )}
                <div>
                  <span className={labelCls}>Minimum booking (0 = any)</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={minBookingAmount}
                    onChange={(e) => setMinBookingAmount(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className={labelCls}>Starts (blank = now)</span>
                  <input
                    type="date"
                    value={startsAt}
                    min={todayISO()}
                    max={todayISO(365)}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className={labelCls}>Expires on *</span>
                  <input
                    type="date"
                    value={expiresAt}
                    min={todayISO()}
                    max={todayISO(365)}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className={labelCls}>Total redemptions (0 = unlimited)</span>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={usageLimit}
                    onChange={(e) => setUsageLimit(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className={labelCls}>Per player (0 = unlimited)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={perUserLimit}
                    onChange={(e) => setPerUserLimit(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsPublic((v) => !v)}
                className={`flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                  isPublic
                    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                    : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
                }`}
              >
                {isPublic ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black">
                    {isPublic ? "Advertise on the venue page" : "Hidden — code still works"}
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    {isPublic
                      ? "Players see it while booking and can tap to apply."
                      : "Only people you share it with can use it."}
                  </span>
                </span>
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${isPublic ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/15"}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${isPublic ? "left-[22px]" : "left-0.5"}`}
                  />
                </span>
              </button>

              {preview && (
                <p className="rounded-xl bg-slate-100 px-3.5 py-3 text-[11px] font-bold leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {preview.belowMin
                    ? `⚠️ A typical 2-hr booking here (${formatNPR(preview.bill)}) is under your ${formatNPR(minBookingAmount)} minimum — players would be turned away.`
                    : discountType === "percent"
                      ? `🧮 Example: ${formatNPR(preview.bill)} booking → ${formatNPR(preview.discount)} off, player pays ${formatNPR(preview.payable)}.`
                      : `🧮 Example: ${formatNPR(preview.bill)} booking → ${formatNPR(preview.discount)} off, player pays ${formatNPR(preview.payable)}.`}
                </p>
              )}

              {formError && (
                <p className="rounded-xl bg-red-500/10 px-4 py-3 text-xs font-bold text-red-600 dark:text-red-400">
                  {formError}
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setShowForm(false);
                  setFormError("");
                }}
                className="rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
              >
                {saving ? "Saving…" : editing ? "Save changes ✨" : "Create code 🎉"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
