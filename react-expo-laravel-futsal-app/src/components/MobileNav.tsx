"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, MapPin, Zap, Bell, CalendarCheck, Trophy } from "lucide-react";
import { useUser } from "./UserProvider";

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/venues", label: "Courts", icon: MapPin },
  { href: "/matches", label: "Matches", icon: Zap },
  { href: "/leagues", label: "Leagues", icon: Trophy },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/notifications", label: "Alerts", icon: Bell, badge: true },
];

export function MobileNav() {
  const pathname = usePathname();
  const { user } = useUser();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/notifications?userId=${user.id}`);
        const data = await res.json();
        if (alive) setUnread(data.unread ?? 0);
      } catch {}
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [user]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[#F0E3CC] bg-white/95 shadow-[0_-8px_30px_rgba(180,120,60,0.10)] backdrop-blur-xl lg:hidden dark:border-white/10 dark:bg-stone-950/95">
      <div className="mx-auto grid max-w-lg grid-cols-5 px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className={`relative flex flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-bold ${
                active ? "text-emerald-700 dark:text-emerald-400" : "text-stone-400 dark:text-stone-500"
              }`}
            >
              <span
                className={`relative grid h-8 w-12 place-items-center rounded-full transition ${
                  active ? "bg-emerald-100 dark:bg-emerald-500/15" : ""
                }`}
              >
                <t.icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                {t.badge && unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white ring-2 ring-white dark:ring-stone-950">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
