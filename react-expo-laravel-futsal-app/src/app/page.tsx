"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  MapPin,
  CalendarCheck,
  Users,
  Zap,
  Star,
  Trophy,
  ChevronRight,
  Heart,
  CreditCard,
  ShieldCheck,
  Play,
  ArrowRight,
  Clock,
  Sparkles,
  MessageCircleHeart,
} from "lucide-react";
import { VenueCard, MatchCard, type VenueWithCourts, type MatchItem } from "@/components/cards";
import { useUser } from "@/components/UserProvider";
import { formatNPR, CITY_OPTIONS } from "@/lib/futsal";
import { validateSearch } from "@/lib/validation";

type Stats = {
  venues: number;
  courts: number;
  bookings: number;
  players: number;
  openMatches: number;
  teams: number;
  revenue: number;
  todaysBookings: number;
  occupancy: number;
};

export default function HomePage() {
  const { user, isOwner } = useUser();
  const [venues, setVenues] = useState<VenueWithCourts[]>([]);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [city, setCity] = useState("All Cities");
  const [cityTouched, setCityTouched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [loading, setLoading] = useState(true);

  const homeCity = (user as { defaultCity?: string } | null)?.defaultCity ?? "All Cities";

  useEffect(() => {
    if (!cityTouched && homeCity && CITY_OPTIONS.includes(homeCity)) {
      setCity(homeCity);
    }
  }, [homeCity, cityTouched]);

  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/seed", { method: "POST" });
        const [vRes, mRes, sRes] = await Promise.all([
          fetch("/api/venues"),
          fetch("/api/matches"),
          fetch("/api/stats"),
        ]);
        const v = await vRes.json();
        const m = await mRes.json();
        const s = await sRes.json();
        setVenues(v.venues ?? []);
        setMatches((m.matches ?? []).slice(0, 3));
        setStats(s.stats ?? null);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const featured = venues.filter((v) => v.isFeatured).slice(0, 3);
  const showVenues = (featured.length > 0 ? featured : venues).slice(0, 3);

  return (
    <main className="turf-pattern min-h-screen">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-orange-300/30 blur-[100px] dark:bg-orange-500/10" />
        <div className="pointer-events-none absolute -right-24 top-40 h-80 w-80 rounded-full bg-emerald-300/30 blur-[100px] dark:bg-emerald-500/10" />
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-12 pt-10 sm:px-6 lg:grid-cols-2 lg:pt-16">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-3.5 py-1.5 text-xs font-bold text-stone-700 shadow-sm dark:border-orange-500/30 dark:bg-stone-900 dark:text-stone-200">
              <Sparkles className="h-3.5 w-3.5 text-orange-500" />
              {user ? `Welcome back, ${user.name.split(" ")[0]}! Your game misses you ⚽` : "Nepal's friendliest futsal family ⚽"}
            </div>
            <h1 className="mt-5 text-4xl font-black leading-[1.08] tracking-tight text-stone-900 sm:text-5xl lg:text-[3.6rem] dark:text-stone-50">
              Grab your friends.{" "}
              <span className="bg-gradient-to-r from-emerald-600 to-orange-500 bg-clip-text text-transparent dark:from-emerald-400 dark:to-orange-400">
                Tonight we play.
              </span>
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
              {stats?.venues ?? 6}+ cosy neighbourhood courts, honest prices, and a
              community that saves you a spot — even if you come alone. Book in a
              minute, pay your way, and just show up to have fun.
            </p>

            {/* Search bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const err = validateSearch(q, { max: 60 });
                if (err) {
                  setSearchError(err);
                  return;
                }
                setSearchError("");
                window.location.href = `/venues?q=${encodeURIComponent(q.trim())}&city=${encodeURIComponent(city)}`;
              }}
              className="mt-6 rounded-3xl border border-[#F0E3CC] bg-white p-2 shadow-[0_16px_40px_rgba(180,120,60,0.12)] dark:border-white/10 dark:bg-stone-900"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex flex-1 items-center gap-2 rounded-2xl bg-[#FFF6E9] px-4 py-3 dark:bg-white/5">
                  <Search className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" />
                  <input
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setSearchError(validateSearch(e.target.value, { max: 60 }) ?? "");
                    }}
                    placeholder="Where do you want to play? (e.g. Chabahil)"
                    maxLength={60}
                    className="w-full bg-transparent text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-stone-100 dark:placeholder:text-stone-500"
                  />
                </label>
                <label className="flex items-center gap-2 rounded-2xl bg-[#FFF6E9] px-4 py-3 sm:w-44 dark:bg-white/5">
                  <MapPin className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" />
                  <select
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      setCityTouched(true);
                    }}
                    title={homeCity !== "All Cities" ? `Home city: ${homeCity} 🏠` : "Pick a city"}
                    className="w-full bg-transparent text-sm font-semibold text-stone-900 focus:outline-none dark:text-stone-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-stone-900 dark:[&>option]:text-stone-100"
                  >
                    {CITY_OPTIONS.map((c) => (
                      <option key={c}>
                        {c}
                        {c === homeCity && c !== "All Cities" ? " 🏠" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-black text-white shadow-md transition hover:bg-emerald-700"
                >
                  Find my court
                </button>
              </div>
              {searchError && <p className="px-2 pb-1 pt-1 text-[11px] font-bold text-red-500">{searchError}</p>}
            </form>
            {user && homeCity !== "All Cities" && (
              <p className="mt-2 text-[11px] font-bold text-stone-400 dark:text-stone-500">
                🏠 Searching in your home city <span className="text-stone-600 dark:text-stone-300">{homeCity}</span> —{" "}
                <Link href="/profile" className="underline hover:text-emerald-600">
                  change it
                </Link>
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Real humans confirm every booking
              </span>
              <span className="flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> eSewa • Khalti (Test) • Cash
              </span>
              <span className="flex items-center gap-1.5">
                <Heart className="h-4 w-4 text-orange-500" /> Free cancellation with a smile
              </span>
            </div>

            {/* Stats */}
            <div className="mt-7 grid grid-cols-4 gap-2 sm:gap-3">
              {[
                { n: `${stats?.venues ?? "—"}`, l: "Courts near you" },
                { n: `${stats?.players ?? "—"}+`, l: "Happy players" },
                { n: `${stats?.bookings ?? "—"}+`, l: "Games played" },
                { n: `${stats?.openMatches ?? "—"}`, l: "Open games" },
              ].map((s) => (
                <div
                  key={s.l}
                  className="rounded-2xl border border-[#F0E3CC] bg-white px-2 py-3 text-center shadow-sm dark:border-white/10 dark:bg-stone-900"
                >
                  <p className="text-xl font-black text-stone-900 sm:text-2xl dark:text-stone-100">{s.n}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500">
                    {s.l}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Hero visual */}
          <div className="relative hidden lg:block">
            <div className="animate-float-slow relative overflow-hidden rounded-[2rem] border-4 border-white shadow-[0_30px_70px_rgba(180,120,60,0.25)] dark:border-stone-900">
              <img
                src="https://images.unsplash.com/photo-1574629810360-7efbbe195018?q=80&w=1200&auto=format&fit=crop"
                alt="Friends playing futsal together"
                className="h-[520px] w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
              {/* Floating booking card */}
              <div className="absolute left-5 right-5 top-5 flex items-center justify-between rounded-2xl bg-white/95 p-3 shadow-lg backdrop-blur-xl dark:bg-stone-900/95">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600">
                    <CalendarCheck className="h-5 w-5 text-white" />
                  </span>
                  <div>
                    <p className="text-xs font-black text-stone-900 dark:text-stone-100">Saturday with the gang 🎉</p>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400">Arena A • Today • 7:00 PM • 5v5</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  YOU'RE IN ✓
                </span>
              </div>
              <div className="absolute bottom-5 left-5 right-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/95 p-3.5 shadow-lg backdrop-blur-xl dark:bg-stone-900/95">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-stone-400 dark:text-stone-500">
                    <Clock className="h-3.5 w-3.5" /> NEXT FREE SLOT
                  </p>
                  <p className="mt-1 text-lg font-black text-stone-900 dark:text-stone-100">Today, 8 PM</p>
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatNPR(2000)}/hr</p>
                </div>
                <div className="rounded-2xl bg-orange-500 p-3.5 shadow-lg">
                  <p className="flex items-center gap-1.5 text-[11px] font-black text-orange-100">
                    <Zap className="h-3.5 w-3.5" /> JOIN US TONIGHT
                  </p>
                  <p className="mt-1 text-sm font-black leading-tight text-white">
                    Friday Night Game — 5 friendly spots left
                  </p>
                </div>
              </div>
            </div>
            {/*
              * Rating badge 🏅 — parked on the photo's left edge, halfway up.
              *
              * It used to sit at `bottom-16`, which on large screens landed it
              * on top of the "NEXT FREE SLOT" card in the photo's bottom row,
              * and being a *sibling* of the floating card it also refused to
              * move while the photo bobbed. Mid-left is the one clear band
              * between the booking card (top) and the slot/join cards (bottom),
              * the explicit top offset keeps it centred without a transform the
              * animation would overwrite, and sharing `animate-float-slow` puts
              * it on the same 5s clock as the photo so the two move together.
              */}
            <div className="animate-float-slow absolute -left-6 top-[calc(50%-2.1rem)] z-10 flex items-center gap-2.5 rounded-2xl border border-[#F0E3CC] bg-white p-3 pr-5 shadow-xl dark:border-white/10 dark:bg-stone-900">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 dark:bg-amber-500/15">
                <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              </span>
              <div>
                <p className="text-sm font-black text-stone-900 dark:text-stone-100">4.8 / 5.0</p>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">from 2,400+ happy players</p>
              </div>
            </div>
          </div>
        </div>

        {/* marquee */}
        <div className="overflow-hidden border-y border-emerald-800 bg-emerald-700 py-3 dark:border-emerald-950 dark:bg-emerald-900">
          <div className="animate-marquee flex w-max items-center gap-8 whitespace-nowrap text-xs font-black uppercase tracking-[0.2em] text-emerald-50">
            {Array.from({ length: 2 }).map((_, k) => (
              <span key={k} className="flex items-center gap-8">
                <span>⚽ Everyone's welcome here</span>
                <span>🤝 Come alone, leave with friends</span>
                <span>🔥 Weekend games & laughter</span>
                <span>💳 Pay your way — eSewa • Khalti</span>
                <span>🏆 Friendly matches daily</span>
                <span>👥 Bring your whole crew</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURED VENUES */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
              Neighbourhood favourites
            </p>
            <h2 className="mt-1 text-2xl font-black text-stone-900 sm:text-3xl dark:text-stone-100">
              Courts our players love
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Hand-picked, honestly priced, always welcoming.</p>
          </div>
          <Link
            href="/venues"
            className="flex shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-white/5"
          >
            See all <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-3xl bg-white dark:bg-stone-900" />
            ))}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showVenues.map((v) => (
              <VenueCard key={v.id} v={v} />
            ))}
          </div>
        )}
      </section>

      {/* HOW IT WORKS */}
      <section className="border-y border-[#F0E3CC] bg-white/60 dark:border-white/10 dark:bg-stone-900/40">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <p className="text-center text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
            Easy as chatting with a friend
          </p>
          <h2 className="mt-1 text-center text-2xl font-black text-stone-900 sm:text-3xl dark:text-stone-100">
            From sofa to kickoff in 3 steps
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Search,
                step: "01",
                title: "Find your spot",
                text: "Browse nearby courts with real photos, honest prices and reviews from players like you.",
                bg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
              },
              {
                icon: CalendarCheck,
                step: "02",
                title: "Book in a minute",
                text: "Pick a time that suits, pay with eSewa, Khalti or cash — the venue confirms personally.",
                bg: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
              },
              {
                icon: Users,
                step: "03",
                title: "Show up & play",
                text: "Bring your energy (or come solo!). Make friends, join weekly games and feel at home.",
                bg: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="relative overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white p-6 shadow-sm dark:border-white/10 dark:bg-stone-900"
              >
                <span className="absolute -right-2 -top-4 text-[88px] font-black text-stone-100 dark:text-white/5">
                  {s.step}
                </span>
                <span className={`grid h-12 w-12 place-items-center rounded-2xl ${s.bg}`}>
                  <s.icon className="h-6 w-6" strokeWidth={2.5} />
                </span>
                <h3 className="mt-4 text-lg font-extrabold text-stone-900 dark:text-stone-100">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-500 dark:text-stone-400">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* OPEN MATCHES */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
              <Zap className="h-3.5 w-3.5" /> Flying solo? Jump in!
            </p>
            <h2 className="mt-1 text-2xl font-black text-stone-900 sm:text-3xl dark:text-stone-100">
              Friendly games this week
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">No team needed — just bring yourself, we&apos;ll handle the rest.</p>
          </div>
          <Link
            href="/matches"
            className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-md transition hover:bg-emerald-700"
          >
            Join a game <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {loading
            ? [0, 1, 2].map((i) => (
                <div key={i} className="h-64 animate-pulse rounded-3xl bg-white dark:bg-stone-900" />
              ))
            : matches.map((m) => <MatchCard key={m.id} m={m} />)}
        </div>
      </section>

      {/* COMMUNITY LOVE */}
      <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] bg-emerald-800 p-8 sm:p-12 dark:border dark:border-white/10 dark:bg-emerald-950">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-amber-300/20 blur-[90px]" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-orange-400/20 blur-[90px]" />
          <div className="relative grid items-center gap-8 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-black text-amber-200">
                <Trophy className="h-3.5 w-3.5" /> THE FAMILY LEAGUE • SEASON 4
              </span>
              <h2 className="mt-4 text-3xl font-black leading-tight text-white sm:text-4xl">
                Got a crew? Play together, laugh together, win together.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-emerald-100/80">
                Start your team in seconds, track your journey, and join weekend
                tournaments across Kathmandu, Lalitpur & Pokhara. Winners take home
                Rs. 1,00,000 — and bragging rights forever. 😄
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {user && isOwner ? (
                  <Link
                    href="/admin"
                    className="rounded-2xl bg-amber-400 px-6 py-3 text-sm font-black text-emerald-950 transition hover:bg-amber-300"
                  >
                    Open owner dashboard 👑
                  </Link>
                ) : (
                  <Link
                    href="/teams"
                    className="rounded-2xl bg-white px-6 py-3 text-sm font-black text-emerald-800 transition hover:bg-emerald-50"
                  >
                    Start your team
                  </Link>
                )}
                <Link
                  href="/venues"
                  className="flex items-center gap-2 rounded-2xl border border-white/30 px-6 py-3 text-sm font-black text-white transition hover:bg-white/10"
                >
                  <Play className="h-4 w-4" /> Book a kickabout
                </Link>
              </div>
            </div>
            <div className="grid gap-3">
              {[
                { q: "Came alone on a Friday, left with 9 new friends. Best decision ever!", n: "Aarav S. • Striker, Kathmandu" },
                { q: "Booking takes a minute and the venue uncle always greets us by name. Feels like home.", n: "Bikash T. • Midfielder, Lalitpur" },
                { q: "Our office team plays every Wednesday now. Zero stress, pure joy.", n: "Priya M. • Captain, Pokhara" },
              ].map((t) => (
                <div key={t.n} className="rounded-2xl bg-white/10 p-4 backdrop-blur">
                  <p className="flex items-start gap-2 text-sm font-semibold leading-relaxed text-white">
                    <MessageCircleHeart className="h-4 w-4 mt-0.5 shrink-0 text-amber-300" />
                    “{t.q}”
                  </p>
                  <p className="mt-1.5 pl-6 text-xs font-bold text-emerald-200/70">{t.n}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#F0E3CC] bg-white/70 dark:border-white/10 dark:bg-stone-950/70">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <p className="text-sm font-bold text-stone-900 dark:text-stone-100">
            Futsal<span className="text-emerald-600 dark:text-emerald-400">Nepal</span>{" "}
            <span className="font-medium text-stone-400 dark:text-stone-500">— made with 💚 for players, by players</span>
          </p>
          <div className="flex gap-5 text-xs font-bold text-stone-500 dark:text-stone-400">
            <Link href="/venues" className="hover:text-emerald-600 dark:hover:text-emerald-400">Courts</Link>
            <Link href="/matches" className="hover:text-emerald-600 dark:hover:text-emerald-400">Games</Link>
            <Link href="/teams" className="hover:text-emerald-600 dark:hover:text-emerald-400">Teams</Link>
            <Link href="/signup" className="hover:text-emerald-600 dark:hover:text-emerald-400">Join us</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
