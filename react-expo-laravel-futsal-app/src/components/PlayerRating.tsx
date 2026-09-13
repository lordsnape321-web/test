"use client";

import { Star } from "lucide-react";
import type { PlayerStats } from "@/lib/loyalty";

export function PlayerRatingBadge({ stats, size = "md" }: { stats: PlayerStats; size?: "sm" | "md" }) {
  const color =
    stats.rating >= 4.5
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : stats.rating >= 3.5
        ? "bg-lime-500/15 text-lime-700 dark:text-lime-300"
        : stats.rating >= 2.5
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : "bg-red-500/15 text-red-600 dark:text-red-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-black ${color} ${
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      }`}
      title={`${stats.completed} played • ${stats.cancelled} cancelled • ${stats.cancelsThisMonth} cancels this month`}
    >
      <Star className={`${size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} fill-current`} />
      {stats.rating.toFixed(1)} {stats.emoji}
    </span>
  );
}

export function PlayerRatingCard({ stats }: { stats: PlayerStats }) {
  const pct = Math.round((stats.rating / 5) * 100);
  return (
    <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-stone-900">
      <h2 className="text-sm font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
        My reliability {stats.emoji}
      </h2>
      <div className="mt-3 flex items-center gap-4">
        <div className="relative grid h-24 w-24 shrink-0 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="10" className="stroke-stone-100 dark:stroke-white/10" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 264} 264`}
              className="stroke-amber-400"
            />
          </svg>
          <div className="text-center">
            <p className="text-xl font-black leading-none">{stats.rating.toFixed(1)}</p>
            <p className="text-[10px] font-bold text-stone-400">/ 5</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-black">{stats.label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
            {stats.total === 0
              ? "Play your first game to earn stars! Every completed game builds trust. 🌱"
              : `${stats.completed} played • ${stats.cancelled} cancelled. Venues see this — keep it shiny! ✨`}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          { l: "Played 🎉", v: stats.completed },
          { l: "Cancelled 🚫", v: stats.cancelled },
          { l: "This month ⚠️", v: `${stats.cancelsThisMonth}/3` },
        ].map((s) => (
          <div key={s.l} className="rounded-xl bg-stone-50 py-2 dark:bg-white/5">
            <p className="text-sm font-black">{s.v}</p>
            <p className="text-[10px] font-bold text-stone-400">{s.l}</p>
          </div>
        ))}
      </div>
      {stats.blocked ? (
        <p className="mt-3 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-xs font-bold leading-relaxed text-red-600 dark:text-red-400">
          🛑 Booking paused — 3 cancels this month. It resets next month. Please honour your games! 🙏
        </p>
      ) : (
        stats.cancelsThisMonth > 0 && (
          <p className="mt-3 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs font-bold leading-relaxed text-amber-700 dark:text-amber-300">
            ⚠️ {stats.cancelsThisMonth}/3 cancels used this month. One more stretch of no-shows pauses booking — play fair! 💛
          </p>
        )
      )}
    </div>
  );
}
