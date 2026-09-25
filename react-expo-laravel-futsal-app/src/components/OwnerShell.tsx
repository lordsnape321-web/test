"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  CalendarCheck,
  Building2,
  Bell,
  LogOut,
  Menu,
  X,
  Trophy,
  ChevronRight,
  Settings,
  User as UserIcon,
} from "lucide-react";
import { useUser } from "./UserProvider";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./Avatar";
import { apiFetch } from "@/lib/api";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/requests", label: "Booking Requests", icon: Inbox, badge: "requests" },
  { href: "/admin/bookings", label: "All Bookings", icon: CalendarCheck },
  { href: "/admin/venues", label: "My Venues", icon: Building2 },
  { href: "/admin/leagues", label: "Leagues", icon: Trophy },
  { href: "/admin/notifications", label: "Notifications", icon: Bell, badge: "unread" },
  { href: "/admin/profile", label: "My Profile", icon: UserIcon },
  // The same hub players get: theme, alerts, account. Owners keep their Studio
  // pages above it — this is the stuff that is about the *person*, not the venue.
  { href: "/settings", label: "Settings", icon: Settings },
];

/*
 * The owner's bottom rail 📱
 *
 * Sized from this array's length instead of a hardcoded `grid-cols-6`, so the
 * column count and the item count can never drift apart — that is exactly what
 * happened on the player rail, where a sixth tab wrapped under a five-column
 * grid. Labels truncate rather than pushing the row wider than the viewport.
 */
const MOBILE_TABS = [
  { href: "/admin", label: "Home", icon: LayoutDashboard, exact: true, count: null },
  { href: "/admin/requests", label: "Requests", icon: Inbox, exact: false, count: "requests" },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck, exact: false, count: null },
  { href: "/admin/venues", label: "Venues", icon: Building2, exact: false, count: null },
  { href: "/admin/leagues", label: "Leagues", icon: Trophy, exact: false, count: null },
  { href: "/admin/notifications", label: "Alerts", icon: Bell, exact: false, count: "unread" },
] as const;

export function OwnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useUser();
  const [drawer, setDrawer] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const refreshBadges = async () => {
      try {
        const [bRes, nRes, vRes] = await Promise.all([
          apiFetch("/api/bookings"),
          apiFetch(`/api/notifications?userId=${user.id}`),
          apiFetch("/api/venues"),
        ]);
        const b = await bRes.json();
        const n = await nRes.json();
        const v = await vRes.json();
        if (cancelled) return;
        const mine = new Set(
          ((v.venues ?? []) as Array<{ id: number; ownerId: number | null }>)
            .filter((x) => x.ownerId === user.id)
            .map((x) => x.id)
        );
        const pending = ((b.bookings ?? []) as Array<{
          status: string;
          venue?: { id: number };
        }>).filter((x) => x.status === "pending" && x.venue && mine.has(x.venue.id));
        setPendingCount(pending.length);
        setUnread(n.unread ?? 0);
      } catch {}
    };

    void refreshBadges();
    // Request actions happen inside the requests page without changing the
    // route. Refresh immediately after its database-backed PATCH completes;
    // the interval remains a fallback for changes made in another tab/device.
    const onBookingsChanged = () => void refreshBadges();
    window.addEventListener("owner-bookings-changed", onBookingsChanged);
    const t = setInterval(() => void refreshBadges(), 15000);
    return () => {
      cancelled = true;
      window.removeEventListener("owner-bookings-changed", onBookingsChanged);
      clearInterval(t);
    };
  }, [user, pathname]);

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  const navList = (
    <nav className="space-y-1">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        const badge =
          item.badge === "requests"
            ? pendingCount
            : item.badge === "unread"
              ? unread
              : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setDrawer(false)}
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${
              active
                ? "bg-slate-900 text-white shadow-md dark:bg-white dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            }`}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            <span className="flex-1">{item.label}</span>
            {badge > 0 && (
              <span
                className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-black ${
                  active ? "bg-orange-500 text-white" : "bg-red-500 text-white"
                }`}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
            {active && <ChevronRight className="h-4 w-4 opacity-50" />}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#FAF3E7] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Topbar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <button
            onClick={() => setDrawer(true)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-700 lg:hidden dark:border-slate-700 dark:text-slate-200"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 dark:ring-1 dark:ring-white/20">
              <Trophy className="h-[18px] w-[18px] text-amber-400" strokeWidth={2.5} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[13px] font-black tracking-tight sm:text-[15px]">
                FutsalNepal <span className="text-orange-500">Studio</span>
              </span>
              <span className="hidden text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 sm:block dark:text-slate-500">
                Owner Console
              </span>
            </span>
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <NotificationBell variant="light" />
            {user && (
              <div className="hidden items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-1.5 pr-3 sm:flex dark:border-slate-700 dark:bg-slate-800/60">
                <Link href="/admin/profile" className="flex items-center gap-2.5" title="My profile">
                  <Avatar user={user} className="h-8 w-8 text-xs" rounded="rounded-lg" />
                  <span className="leading-tight">
                    <span className="block max-w-[120px] truncate text-xs font-extrabold">
                      {user.name}
                    </span>
                    <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500">
                      Venue Owner
                    </span>
                  </span>
                </Link>
                <button
                  onClick={handleLogout}
                  title="Log out"
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6 sm:px-6">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {navList}
            </div>
            <div className="overflow-hidden rounded-2xl bg-slate-900 p-5 text-white dark:border dark:border-white/10">
              <p className="text-sm font-black">Need more bookings? 📈</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Accept requests fast — venues that respond within 15 minutes get
                3× more repeat players.
              </p>
              <Link
                href="/admin/requests"
                className="mt-3 block rounded-xl bg-amber-400 py-2.5 text-center text-xs font-black text-slate-950 transition hover:bg-amber-300"
              >
                Review requests
              </Link>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between pb-3">
              <span className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 dark:ring-1 dark:ring-white/20">
                  <Trophy className="h-[18px] w-[18px] text-amber-400" />
                </span>
                <span className="text-sm font-black">Owner Studio</span>
              </span>
              <button
                onClick={() => setDrawer(false)}
                className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 dark:border-slate-700"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{navList}</div>
            <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav for owners on mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-950/95">
        <div
          className="grid px-1"
          style={{ gridTemplateColumns: `repeat(${MOBILE_TABS.length}, minmax(0, 1fr))` }}
        >
          {MOBILE_TABS.map((t) => {
            const active = t.exact
              ? pathname === t.href
              : pathname === t.href || pathname.startsWith(t.href + "/");
            const count =
              t.count === "requests" ? pendingCount : t.count === "unread" ? unread : 0;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-w-0 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold ${
                  active ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"
                }`}
              >
                <t.icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 2} />
                <span className="w-full truncate text-center">{t.label}</span>
                {count > 0 && (
                  <span className="absolute right-1/2 top-1 grid h-4 min-w-4 translate-x-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
                    {count > 9 ? "9+" : count}
                  </span>
                )}
                {active && <span className="h-1 w-6 max-w-full rounded-full bg-slate-900 dark:bg-white" />}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="h-16 lg:hidden" />
    </div>
  );
}
