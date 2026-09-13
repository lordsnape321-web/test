"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Trophy,
  MapPin,
  Users,
  CalendarCheck,
  LayoutDashboard,
  Menu,
  X,
  Zap,
  ChevronDown,
  LogOut,
  LogIn,
  UserPlus,
  Bell,
} from "lucide-react";
import { useUser } from "./UserProvider";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./Avatar";

const PUBLIC_LINKS = [
  { href: "/venues", label: "Find Courts", icon: MapPin },
  { href: "/matches", label: "Find Match", icon: Zap },
  { href: "/teams", label: "Teams", icon: Users },
];

const PLAYER_LINKS = [
  ...PUBLIC_LINKS,
  { href: "/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/notifications", label: "Alerts", icon: Bell },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isOwner } = useUser();
  const { logout } = useUser();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const LINKS = !user ? PUBLIC_LINKS : isOwner ? PUBLIC_LINKS : PLAYER_LINKS;

  const handleLogout = () => {
    logout();
    setProfileOpen(false);
    setOpen(false);
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[#F0E3CC] bg-[#FFFDF7]/90 backdrop-blur-xl dark:border-white/10 dark:bg-stone-950/90">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-700 shadow-[0_8px_20px_rgba(5,150,105,0.35)]">
            <Trophy className="h-5 w-5 text-white" strokeWidth={2.5} />
          </span>
          <span className="leading-tight">
            <span className="block text-[17px] font-black tracking-tight text-stone-900 dark:text-stone-100">
              Futsal<span className="text-emerald-600 dark:text-emerald-400">Nepal</span>
            </span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500">
              Friends • Fun • Football
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-emerald-600 text-white shadow-md"
                    : "text-stone-600 hover:bg-orange-100/70 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-white/5 dark:hover:text-white"
                }`}
              >
                <l.icon className="h-4 w-4" />
                {l.label}
              </Link>
            );
          })}
          {user && isOwner && (
            <Link
              href="/admin"
              className="ml-1 flex items-center gap-1.5 rounded-full bg-orange-500 px-4 py-2 text-sm font-black text-white transition hover:bg-orange-600"
            >
              <LayoutDashboard className="h-4 w-4" />
              Owner Studio
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user && <NotificationBell variant="dark" />}
          {!user ? (
            <div className="hidden items-center gap-2 sm:flex">
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-white/5"
              >
                <LogIn className="h-4 w-4" /> Log in
              </Link>
              <Link
                href="/signup"
                className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-md transition hover:bg-emerald-700"
              >
                <UserPlus className="h-4 w-4" /> Join free
              </Link>
            </div>
          ) : (
            <div className="relative hidden sm:block">
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-stone-200 bg-white py-1.5 pl-1.5 pr-3 text-left shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-stone-900 dark:hover:bg-white/5"
              >
                <Avatar user={user} className="h-8 w-8 text-xs" />
                <span className="leading-tight">
                  <span className="block max-w-[130px] truncate text-xs font-bold text-stone-900 dark:text-stone-100">
                    {user.name}
                  </span>
                  <span className="block max-w-[130px] truncate text-[10px] font-medium text-stone-500 dark:text-stone-400">
                    {isOwner ? "Venue Owner" : `${user.level} • ${user.position}`}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 text-stone-400 dark:text-stone-500" />
              </button>
              {profileOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setProfileOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-white/10 dark:bg-stone-900">
                    <div className="border-b border-stone-100 bg-orange-50/60 px-4 py-3 dark:border-white/5 dark:bg-orange-500/10">
                      <p className="truncate text-sm font-extrabold text-stone-900 dark:text-stone-100">{user.name}</p>
                      <p className="truncate text-xs text-stone-500 dark:text-stone-400">{user.email}</p>
                      <p className="mt-1 text-[11px] font-bold text-stone-400 dark:text-stone-500">
                        {isOwner
                          ? "Venue Owner account"
                          : `${user.level} • ${user.position} • ${user.matchesPlayed} games`}
                      </p>
                    </div>
                    <div className="p-1.5">
                      <Link
                        href={isOwner ? "/admin" : "/bookings"}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-800 transition hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-white/5"
                      >
                        {isOwner ? (
                          <LayoutDashboard className="h-4 w-4 text-orange-500" />
                        ) : (
                          <CalendarCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        )}
                        {isOwner ? "Open Owner Studio" : "My Bookings"}
                      </Link>
                      {!isOwner && (
                        <Link
                          href="/notifications"
                          onClick={() => setProfileOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-800 transition hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-white/5"
                        >
                          <Bell className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          Notifications
                        </Link>
                      )}
                      <Link
                        href={isOwner ? "/admin/profile" : "/profile"}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-800 transition hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-white/5"
                      >
                        <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        My profile
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-red-500 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        <LogOut className="h-4 w-4" /> Log out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-stone-200 bg-white text-stone-700 shadow-sm lg:hidden dark:border-white/10 dark:bg-stone-900 dark:text-stone-200"
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-[#F0E3CC] bg-[#FFFDF7] px-4 pb-4 pt-2 lg:hidden dark:border-white/10 dark:bg-stone-950">
          <div className="grid gap-1">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold ${
                    active
                      ? "bg-emerald-600 text-white"
                      : "bg-stone-100 text-stone-700 dark:bg-white/5 dark:text-stone-200"
                  }`}
                >
                  <l.icon className="h-4 w-4" />
                  {l.label}
                </Link>
              );
            })}
            {user && isOwner && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl bg-orange-500 px-4 py-3 text-sm font-black text-white"
              >
                <LayoutDashboard className="h-4 w-4" />
                Open Owner Studio
              </Link>
            )}
          </div>
          <div className="mt-3 border-t border-stone-100 pt-3 dark:border-white/5">
            {!user ? (
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white py-3 text-sm font-black text-stone-700 dark:border-white/10 dark:bg-stone-900 dark:text-stone-200"
                >
                  <LogIn className="h-4 w-4" /> Log in
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-black text-white"
                >
                  <UserPlus className="h-4 w-4" /> Join free
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-stone-900">
                <Avatar user={user} className="h-10 w-10 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-stone-900 dark:text-stone-100">{user.name}</p>
                  <p className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
                    {isOwner ? "👑 Venue Owner" : `⚽ Player • ${user.level}`}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-black text-red-500 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
                >
                  <LogOut className="h-3.5 w-3.5" /> Out
                </button>
              </div>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
