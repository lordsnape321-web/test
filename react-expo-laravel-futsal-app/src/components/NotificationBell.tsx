"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useUser } from "./UserProvider";

type N = {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string | null;
};

export function timeAgo(iso: string | null) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell({ variant }: { variant: "dark" | "light" }) {
  const { user, isOwner } = useUser();
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dark = variant === "dark";

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/notifications?userId=${user.id}`);
      const data = await res.json();
      setItems((data.notifications ?? []).slice(0, 8));
      setUnread(data.unread ?? 0);
    } catch {}
  }, [user]);

  useEffect(() => {
    load();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(load, 15000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  if (!user) return null;

  const allLink = isOwner ? "/admin/notifications" : "/notifications";

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          load();
        }}
        aria-label="Notifications"
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-stone-200 bg-white text-stone-600 shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-white/5"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white ring-2 ring-white dark:ring-stone-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-4 right-4 top-[64px] z-50 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[330px] dark:border-white/10 dark:bg-stone-900">
            <div className="flex items-center justify-between border-b border-stone-100 bg-orange-50/50 px-4 py-3 dark:border-white/5 dark:bg-orange-500/10">
              <p className="text-sm font-black text-stone-900 dark:text-stone-100">
                Notifications
                {unread > 0 && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black text-red-600 dark:bg-red-500/15 dark:text-red-400">
                    {unread} new
                  </span>
                )}
              </p>
              <Link
                href={allLink}
                onClick={() => setOpen(false)}
                className={`text-xs font-black ${dark ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}
              >
                View all
              </Link>
            </div>
            <div className="max-h-[55vh] overflow-y-auto sm:max-h-[340px]">
              {items.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-stone-400 dark:text-stone-500">
                  All quiet here. Time to book a game! ⚽
                </p>
              )}
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    try {
                      await fetch(`/api/notifications/${n.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ isRead: true }),
                      });
                    } catch {}
                    setOpen(false);
                    window.location.href = n.link || allLink;
                  }}
                  className={`block w-full border-b border-stone-50 px-4 py-3 text-left transition last:border-0 hover:bg-orange-50/60 dark:border-white/5 dark:hover:bg-orange-500/10 ${
                    n.isRead ? "" : "bg-orange-50/50 dark:bg-orange-500/10"
                  }`}
                >
                  <p className="text-[13px] font-bold leading-snug text-stone-900 dark:text-stone-100">
                    {!n.isRead && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />}
                    {n.title}
                  </p>
                  {n.message && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                      {n.message}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                    {timeAgo(n.createdAt)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
