"use client";

import { useMemo } from "react";
import { TrendingUp, PieChart as PieIcon, Wallet, Flame } from "lucide-react";
import { formatNPR } from "@/lib/futsal";

// Warm, friendly rainbow palette — one colour per bar.
const RAINBOW = [
  { from: "#10b981", to: "#34d399", soft: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", emoji: "🌱" },
  { from: "#f59e0b", to: "#fbbf24", soft: "bg-amber-500/15 text-amber-700 dark:text-amber-300", emoji: "☀️" },
  { from: "#8b5cf6", to: "#a78bfa", soft: "bg-violet-500/15 text-violet-700 dark:text-violet-300", emoji: "💜" },
  { from: "#06b6d4", to: "#22d3ee", soft: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300", emoji: "🌊" },
  { from: "#f97316", to: "#fb923c", soft: "bg-orange-500/15 text-orange-700 dark:text-orange-300", emoji: "🔥" },
  { from: "#ec4899", to: "#f472b6", soft: "bg-pink-500/15 text-pink-700 dark:text-pink-300", emoji: "🌸" },
  { from: "#84cc16", to: "#a3e635", soft: "bg-lime-500/15 text-lime-700 dark:text-lime-300", emoji: "⚽" },
];

const DAY_EMOJI = ["🌙", "🌱", "🌊", "☀️", "🌈", "🎉", "⚽"];

function dayLabel(iso: string) {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short" });
  } catch {
    return iso.slice(5);
  }
}

export function RevenueRainbow({ data }: { data: Array<[string, number]> }) {
  const max = Math.max(1, ...data.map(([, v]) => v));
  const total = data.reduce((s, [, v]) => s + v, 0);
  const best = data.length > 0 ? data.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
          <TrendingUp className="h-4 w-4 text-emerald-500" /> Money garden 🌱
        </h2>
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
          No earnings yet — accept requests and watch this garden bloom! 💰
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
          <TrendingUp className="h-4 w-4 text-emerald-500" /> Money garden 🌱
        </h2>
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-black text-emerald-700 dark:text-emerald-300">
          {formatNPR(total)} in {data.length} day{data.length > 1 ? "s" : ""}
        </span>
      </div>
      {best && (
        <p className="mt-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
          🏆 Best day: {dayLabel(best[0])} with {formatNPR(best[1])} — keep that energy!
        </p>
      )}
      <div className="mt-4 flex h-48 items-end gap-2 sm:gap-3">
        {data.map(([day, val], i) => {
          const c = RAINBOW[i % RAINBOW.length];
          const pct = Math.max(8, (val / max) * 100);
          return (
            <div key={day} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className={`text-[10px] font-black ${c.soft.split(" ")[1]}`}>
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
              </span>
              <div
                className="relative flex w-full items-start justify-center overflow-hidden rounded-t-xl rounded-b-md pt-1.5 shadow-sm transition-transform hover:scale-[1.03]"
                style={{
                  height: `${pct}%`,
                  background: `linear-gradient(180deg, ${c.to}, ${c.from})`,
                }}
                title={`${dayLabel(day)}: ${formatNPR(val)}`}
              >
                <span className="text-sm leading-none drop-shadow">{c.emoji}</span>
              </div>
              <span className="text-center text-[10px] font-black leading-tight text-slate-500 dark:text-slate-400">
                {dayLabel(day)}
                <span className="block font-bold text-slate-400 dark:text-slate-500">
                  {day.slice(5)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BookingDonut({
  counts,
}: {
  counts: { pending: number; confirmed: number; completed: number; cancelled: number; rejected: number };
}) {
  const segments = useMemo(() => {
    const total =
      counts.pending + counts.confirmed + counts.completed + counts.cancelled + counts.rejected;
    if (total === 0) return [];
    const defs = [
      { label: "Waiting for you", value: counts.pending, color: "#f59e0b", emoji: "⏳" },
      { label: "Confirmed", value: counts.confirmed, color: "#10b981", emoji: "✅" },
      { label: "Played & happy", value: counts.completed, color: "#8b5cf6", emoji: "🎉" },
      { label: "Cancelled", value: counts.cancelled, color: "#94a3b8", emoji: "💤" },
      { label: "Declined", value: counts.rejected, color: "#ef4444", emoji: "🙏" },
    ].filter((d) => d.value > 0);
    let acc = 0;
    return defs.map((d) => {
      const start = acc;
      acc += (d.value / total) * 360;
      return { ...d, total, start, end: acc, pct: Math.round((d.value / total) * 100) };
    });
  }, [counts]);

  const gradient =
    segments.length === 0
      ? "conic-gradient(#e2e8f0 0 360deg)"
      : `conic-gradient(${segments
          .map((s) => `${s.color} ${s.start}deg ${s.end}deg`)
          .join(", ")})`;

  const total = segments.reduce((s, x) => s + x.value, 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
        <PieIcon className="h-4 w-4 text-violet-500" /> Booking rainbow 🍩
      </h2>
      {segments.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
          Your booking story starts here — every slice is a happy player! 🌈
        </p>
      ) : (
        <div className="mt-4 flex items-center gap-5">
          <div className="relative h-36 w-36 shrink-0">
            <div
              className="h-full w-full rounded-full shadow-inner"
              style={{ background: gradient }}
            />
            <div className="absolute inset-[26px] grid place-items-center rounded-full bg-white text-center shadow dark:bg-slate-900">
              <div>
                <p className="text-2xl font-black leading-none">{total}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase text-slate-400">bookings</p>
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs font-bold">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="truncate text-slate-600 dark:text-slate-300">
                  {s.emoji} {s.label}
                </span>
                <span className="ml-auto shrink-0 text-slate-900 dark:text-slate-100">
                  {s.value} ({s.pct}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const METHOD_STYLE: Record<string, { color: string; bg: string; emoji: string }> = {
  eSewa: { color: "#16a34a", bg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", emoji: "💚" },
  Khalti: { color: "#9333ea", bg: "bg-purple-500/15 text-purple-700 dark:text-purple-300", emoji: "💜" },
  "Cash at Venue": { color: "#d97706", bg: "bg-amber-500/15 text-amber-700 dark:text-amber-300", emoji: "💵" },
};

export function PaymentParty({ byMethod }: { byMethod: Array<[string, number, number]> }) {
  const max = Math.max(1, ...byMethod.map(([, , amt]) => amt));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
        <Wallet className="h-4 w-4 text-sky-500" /> How friends pay 🎊
      </h2>
      {byMethod.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
          Payment stories will dance here soon! 💃
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {byMethod.map(([method, count, amt]) => {
            const s = METHOD_STYLE[method] ?? METHOD_STYLE["Cash at Venue"];
            return (
              <div key={method}>
                <div className="flex items-center justify-between text-xs font-black">
                  <span className={`rounded-full px-2.5 py-1 ${s.bg}`}>
                    {s.emoji} {method} × {count}
                  </span>
                  <span className="text-slate-700 dark:text-slate-200">{formatNPR(amt)}</span>
                </div>
                <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(6, (amt / max) * 100)}%`,
                      background: `linear-gradient(90deg, ${s.color}, ${s.color}88)`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PeakHours({ byHour }: { byHour: Array<[string, number]> }) {
  const max = Math.max(1, ...byHour.map(([, n]) => n));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
        <Flame className="h-4 w-4 text-orange-500" /> Busiest kickoff times 🔥
      </h2>
      {byHour.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
          Rush hours will glow here once games roll in! ⚽
        </p>
      ) : (
        <div className="mt-4 flex h-36 items-end gap-1.5">
          {byHour.map(([hour, n], i) => (
            <div key={hour} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] font-black text-slate-600 dark:text-slate-300">{n}×</span>
              <div
                className="w-full rounded-t-lg"
                style={{
                  height: `${Math.max(8, (n / max) * 100)}%`,
                  background: `linear-gradient(180deg, #fb923c, #f97316 ${30 + i * 8}%, #c2410c)`,
                  opacity: 0.55 + (n / max) * 0.45,
                }}
                title={`${hour}: ${n} bookings`}
              />
              <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">
                {hour}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
        {DAY_EMOJI[new Date().getDay()]} Tip: evenings fill fastest — nudge players toward sunny morning slots for easy wins! ☀️
      </p>
    </div>
  );
}
