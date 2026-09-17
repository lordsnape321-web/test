"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MapPin, Zap, CalendarCheck, Settings } from "lucide-react";

/*
 * The bottom rail 📱
 *
 * Five tabs, and deliberately no more: the grid below is sized from this array's
 * length instead of a hardcoded `grid-cols-5`, because the rail once carried six
 * items against a five-column grid and the sixth wrapped onto a second row that
 * sat under the fold of the nav's own background.
 *
 * Two things are intentionally *not* here:
 *  - Leagues — they are matches with a table attached, so they live behind the
 *    toggle on the Matches tab (`/matches?tab=leagues`).
 *  - Alerts — notifications are reached through the bell in the top bar, which is
 *    visible on mobile too. A tab and a bell for the same inbox was two doors to
 *    one room, and the tab was the one that cost the rail its width.
 */
const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/venues", label: "Courts", icon: MapPin },
  { href: "/matches", label: "Matches", icon: Zap },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[#F0E3CC] bg-white/95 shadow-[0_-8px_30px_rgba(180,120,60,0.10)] backdrop-blur-xl lg:hidden dark:border-white/10 dark:bg-stone-950/95">
      <div
        className="mx-auto grid max-w-lg gap-x-1 px-2 pb-[env(safe-area-inset-bottom)]"
        style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
      >
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-bold transition ${
                active ? "text-emerald-700 dark:text-emerald-400" : "text-stone-400 dark:text-stone-500"
              }`}
            >
              <span
                className={`grid h-8 w-12 max-w-full place-items-center rounded-full transition ${
                  active ? "bg-emerald-100 dark:bg-emerald-500/15" : ""
                }`}
              >
                <t.icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              </span>
              <span className="w-full truncate text-center">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
