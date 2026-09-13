"use client";

import Link from "next/link";
import { MapPin, Star, Users, Clock, ArrowRight, Zap, BadgeCheck } from "lucide-react";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { Avatar } from "./Avatar";

export type VenueWithCourts = {
  id: number;
  name: string;
  address: string;
  city: string;
  phone: string;
  description: string;
  imageUrl: string;
  rating: number;
  totalReviews: number;
  openingHour: number;
  closingHour: number;
  amenities: string;
  isFeatured: boolean;
  courtCount: number;
  minPrice: number;
};

export function VenueCard({ v }: { v: VenueWithCourts }) {
  return (
    <Link
      href={`/venues/${v.id}`}
      className="card-glow group overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white shadow-[0_10px_30px_rgba(180,120,60,0.08)] transition hover:-translate-y-1 hover:border-emerald-300 dark:border-white/10 dark:bg-stone-900 dark:hover:border-emerald-500/50"
    >
      <div className="relative h-48 overflow-hidden">
        <img
          src={v.imageUrl}
          alt={v.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        {v.isFeatured && (
          <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-md">
            <Zap className="h-3 w-3" /> Loved by players
          </span>
        )}
        <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-stone-800 shadow backdrop-blur dark:bg-stone-900/95 dark:text-stone-100">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          {v.rating.toFixed(1)}
          <span className="font-medium text-stone-400 dark:text-stone-500">({v.totalReviews})</span>
        </span>
        <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-emerald-700 shadow backdrop-blur dark:bg-stone-900/95 dark:text-emerald-300">
          From {formatNPR(v.minPrice)}/hr
        </span>
      </div>
      <div className="p-4">
        <h3 className="truncate text-[15px] font-extrabold text-stone-900 group-hover:text-emerald-700 dark:text-stone-100 dark:group-hover:text-emerald-400">
          {v.name}
        </h3>
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-stone-500 dark:text-stone-400">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {v.address} • {v.city}
        </p>
        <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3 dark:border-white/5">
          <span className="flex items-center gap-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
            <Users className="h-3.5 w-3.5" /> {v.courtCount} courts
          </span>
          <span className="flex items-center gap-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
            <Clock className="h-3.5 w-3.5" />
            {v.openingHour}:00 – {v.closingHour}:00
          </span>
          <span className="flex items-center gap-1 text-xs font-black text-emerald-600 dark:text-emerald-400">
            Book <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export type MatchItem = {
  id: number;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  pricePerPlayer: number;
  chargeMode?: string;
  maxPlayers: number;
  joinedCount: number;
  spotsLeft: number;
  crewSize?: number;
  otherJoined?: number;
  openSpots?: number;
  level: string;
  status: string;
  description: string;
  bookingId?: number | null;
  venue?: { name: string; address: string; city: string; imageUrl: string };
  players?: Array<{ id: number; name: string; avatarColor: string; avatarUrl?: string }>;
  organizer?: { name: string };
};

export function MatchCard({ m }: { m: MatchItem }) {
  const pct = Math.round((m.joinedCount / Math.max(1, m.maxPlayers)) * 100);
  const full = m.spotsLeft === 0;
  const crew = m.crewSize ?? 1;
  const others = m.otherJoined ?? Math.max(0, m.joinedCount - crew);
  return (
    <div className="overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-[0_10px_30px_rgba(180,120,60,0.08)] transition hover:border-emerald-300 dark:border-white/10 dark:bg-stone-900 dark:hover:border-emerald-500/50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-extrabold leading-snug text-stone-900 dark:text-stone-100">{m.title}</h3>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            hosted by {m.organizer?.name ?? "a friend"} • {m.level === "All Levels" ? "🌍 Anyone welcome" : `🎯 ${m.level}`}
          </p>
          <p className="mt-1 text-[11px] font-bold text-stone-400 dark:text-stone-500">
            👥 {crew} crew • 🙋 {others} joined
          </p>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {m.bookingId ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <BadgeCheck className="h-3 w-3" /> Court already sorted
              </span>
            ) : null}
            {m.chargeMode === "custom" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-black text-violet-700 dark:text-violet-300">
                ✨ Custom {formatNPR(m.pricePerPlayer)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-black text-sky-700 dark:text-sky-300">
                🤝 Fair split
              </span>
            )}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
            full
              ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
              : "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
          }`}
        >
          {full ? "Full house" : `${m.spotsLeft} spots left`}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-[#FFF6E9] px-2 py-2.5 dark:bg-white/5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">Date</p>
          <p className="mt-0.5 truncate text-xs font-extrabold text-stone-900 dark:text-stone-100">{prettyDate(m.date)}</p>
        </div>
        <div className="rounded-2xl bg-[#FFF6E9] px-2 py-2.5 dark:bg-white/5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">Time</p>
          <p className="mt-0.5 truncate text-xs font-extrabold text-stone-900 dark:text-stone-100">{formatTime12(m.startTime)}</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 px-2 py-2.5 dark:bg-emerald-500/10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">Share</p>
          <p className="mt-0.5 truncate text-xs font-extrabold text-emerald-700 dark:text-emerald-300">{formatNPR(m.pricePerPlayer)}</p>
        </div>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 truncate text-xs text-stone-500 dark:text-stone-400">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        {m.venue?.name ?? ""} — {m.venue?.address ?? ""}
      </p>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] font-bold">
          <span className="text-stone-500 dark:text-stone-400">
            {m.joinedCount}/{m.maxPlayers} friends in
          </span>
          <span className="text-emerald-600 dark:text-emerald-400">{pct}% full</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-orange-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex -space-x-2">
          {(m.players ?? []).slice(0, 5).map((p) => (
            <span key={p.id} title={p.name}>
              <Avatar user={{ name: p.name, avatarColor: p.avatarColor, avatarUrl: p.avatarUrl }} className="h-7 w-7 text-[10px]" ring="border-2 border-white shadow dark:border-stone-900" />
            </span>
          ))}
          {m.joinedCount > 5 && (
            <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-stone-200 text-[10px] font-black text-stone-600 dark:border-stone-900 dark:bg-white/10 dark:text-stone-300">
              +{m.joinedCount - 5}
            </span>
          )}
        </div>
        <Link
          href="/matches"
          className="flex items-center gap-1 rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white transition hover:bg-emerald-700"
        >
          View <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
