"use client";
import { ThemedSelect } from "@/components/ThemedSelect";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, MapPin, SlidersHorizontal, Star, Banknote, HeartHandshake } from "lucide-react";
import { VenueCard, type VenueWithCourts } from "@/components/cards";
import { useUser } from "@/components/UserProvider";
import { CITY_OPTIONS } from "@/lib/futsal";
import { validateSearch } from "@/lib/validation";
import { apiFetch } from "@/lib/api";

function VenuesInner() {
  const params = useSearchParams();
  const { user } = useUser();
  const [venues, setVenues] = useState<VenueWithCourts[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [searchError, setSearchError] = useState("");
  const homeCity = (user as { defaultCity?: string } | null)?.defaultCity ?? "All Cities";
  const [city, setCity] = useState(params.get("city") ?? "All Cities");
  const [sort, setSort] = useState("rating");
  const [maxPrice, setMaxPrice] = useState(3000);

  useEffect(() => {
    const fromUrl = params.get("city");
    if (!fromUrl && homeCity && CITY_OPTIONS.includes(homeCity)) {
      setCity(homeCity);
    }
  }, [homeCity, params]);

  useEffect(() => {
    (async () => {
      try {
        await apiFetch("/api/seed", { method: "POST" });
        const res = await apiFetch("/api/venues");
        const data = await res.json();
        setVenues(data.venues ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const safeQ = validateSearch(q, { max: 60 }) ? "" : q.trim();
  const filtered = useMemo(() => {
    let list = [...venues];
    if (safeQ) {
      const ql = safeQ.toLowerCase();
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(ql) ||
          v.address.toLowerCase().includes(ql) ||
          v.city.toLowerCase().includes(ql)
      );
    }
    if (city !== "All Cities") list = list.filter((v) => v.city === city);
    list = list.filter((v) => v.minPrice <= maxPrice);
    if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
    if (sort === "price-low") list.sort((a, b) => a.minPrice - b.minPrice);
    if (sort === "price-high") list.sort((a, b) => b.minPrice - a.minPrice);
    return list;
  }, [venues, safeQ, city, sort, maxPrice]);

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
          <HeartHandshake className="h-3.5 w-3.5" /> Pick your second home
        </p>
        <h1 className="mt-1 text-3xl font-black text-stone-900 dark:text-slate-100">Courts near you</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-slate-400">
          {filtered.length} welcoming venues • honest prices • real people confirm your game
          {homeCity !== "All Cities" && ` • 🏠 home: ${homeCity}`}
        </p>

        {/* Filters */}
        <div className="mt-5 rounded-3xl border border-[#F0E3CC] bg-white p-3 shadow-[0_10px_30px_rgba(180,120,60,0.08)] dark:border-white/10 dark:bg-slate-900">
          <div className="flex flex-col gap-2 lg:flex-row">
            <label className="flex flex-1 items-center gap-2 rounded-2xl bg-[#FFF6E9] px-4 py-3 dark:bg-white/5">
              <Search className="h-4 w-4 shrink-0 text-stone-400 dark:text-slate-500" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value.slice(0, 60));
                  setSearchError(validateSearch(e.target.value, { max: 60 }) ?? "");
                }}
                placeholder="Try a neighbourhood or court name…"
                maxLength={60}
                className="w-full bg-transparent text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </label>
            <label className="flex items-center gap-2 rounded-2xl bg-[#FFF6E9] px-4 py-3 lg:w-48 dark:bg-white/5">
              <MapPin className="h-4 w-4 shrink-0 text-stone-400 dark:text-slate-500" />
              <ThemedSelect
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full bg-transparent text-sm font-semibold text-stone-900 focus:outline-none dark:text-slate-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
              >
                {CITY_OPTIONS.map((c) => (
                  <option key={c}>
                    {c}
                    {c === homeCity && c !== "All Cities" ? " 🏠" : ""}
                  </option>
                ))}
              </ThemedSelect>
            </label>
            <label className="flex items-center gap-2 rounded-2xl bg-[#FFF6E9] px-4 py-3 lg:w-52 dark:bg-white/5">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-stone-400 dark:text-slate-500" />
              <ThemedSelect
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="w-full bg-transparent text-sm font-semibold text-stone-900 focus:outline-none dark:text-slate-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
              >
                <option value="rating">Most loved</option>
                <option value="price-low">Price: low → high</option>
                <option value="price-high">Price: high → low</option>
              </ThemedSelect>
            </label>
          </div>
          {searchError && <p className="mt-1.5 text-[11px] font-bold text-red-500">{searchError}</p>}
          {/*
            * Price slider.
            *
            * Label above the track rather than beside it. "Up to Rs. 3,000/hr" is
            * `whitespace-nowrap`, and a range input will not shrink below its
            * intrinsic width — side by side they needed ~300px inside a 256px
            * content box on a 320px phone, which pushed the whole filter card
            * (and the page) into horizontal scroll.
            */}
          <div className="mt-2 rounded-2xl bg-[#FFF6E9] px-4 py-2.5 dark:bg-white/5">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="whitespace-nowrap text-xs font-bold text-stone-600 dark:text-slate-300">
                Up to Rs. {maxPrice.toLocaleString()}/hr
              </span>
            </div>
            <input
              type="range"
              min={1000}
              max={3000}
              step={100}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              aria-label={`Maximum price per hour, currently Rs. ${maxPrice.toLocaleString()}`}
              className="mt-1.5 w-full accent-emerald-600"
            />
          </div>
        </div>

        {/* City pills */}
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
          {CITY_OPTIONS.map((c) => (
            <button
              key={c}
              onClick={() => setCity(c)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-black transition ${
                city === c
                  ? "bg-emerald-600 text-white shadow-md"
                  : "border border-stone-200 bg-white text-stone-600 shadow-sm hover:bg-orange-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-white/5"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-3xl bg-white dark:bg-slate-900" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center dark:border-white/20 dark:bg-slate-900">
            <Star className="mx-auto h-10 w-10 text-stone-300 dark:text-slate-600" />
            <h3 className="mt-3 text-lg font-extrabold text-stone-900 dark:text-slate-100">Hmm, nothing found</h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-slate-400">
              Try a different area or stretch the budget a little — your perfect court is out there!
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((v) => (
              <VenueCard key={v.id} v={v} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default function VenuesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FFF9F0] dark:bg-slate-950" />}>
      <VenuesInner />
    </Suspense>
  );
}
