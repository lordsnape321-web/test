"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useUser } from "./UserProvider";
import { apiFetch } from "@/lib/api";
import { SwipeNotificationRow } from "@/components/SwipeNotificationRow";

export { timeAgo } from "@/lib/time";

type N = {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string | null;
};

export function NotificationBell({ variant }: { variant: "dark" | "light" }) {
  const { user, isOwner } = useUser();
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  /** Which row is being ticked off — 0 for none, -1 for "all of them". */
  const [marking, setMarking] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dark = variant === "dark";

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/api/notifications?userId=${user.id}`, { cache: "no-store" });
      const data = await res.json();
      setItems((data.notifications ?? []).slice(0, 8));
      setUnread(data.unread ?? 0);
    } catch {}
  }, [user]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    if (timer.current) clearInterval(timer.current);
    // Keep the compact inbox live while it is open; a slower badge refresh is
    // enough when the popover is closed.
    timer.current = setInterval(load, open ? 4000 : 15000);
    return () => {
      window.clearTimeout(initial);
      if (timer.current) clearInterval(timer.current);
    };
  }, [load, open]);

  if (!user) return null;

  const allLink = isOwner ? "/admin/notifications" : "/notifications";

  /** A right swipe marks one row read only after the API confirms it. */
  async function markRead(n: N) {
    if (n.isRead) return;
    setMarking(n.id);
    try {
      const res = await apiFetch(`/api/notifications/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      if (!res.ok) throw new Error("Could not mark notification read");
      await load();
    } catch {}
    setMarking(0);
  }

  /** A left swipe deletes one row through the database-backed endpoint. */
  async function remove(id: number) {
    setMarking(id);
    try {
      const res = await apiFetch(`/api/notifications/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete notification");
      await load();
    } catch {}
    setMarking(0);
  }

  async function openNotification(n: N) {
    try {
      const res = await apiFetch(`/api/notifications/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      if (!res.ok) throw new Error("Could not mark notification read");
    } catch {}
    setOpen(false);
    window.location.href = n.link || allLink;
  }

  /** The whole lot at once — what you want after a week away. */
  async function markAllRead() {
    const uid = user?.id ?? 0;
    if (!uid) return;
    setMarking(-1);
    try {
      const res = await apiFetch(`/api/notifications/read-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid }),
      });
      if (!res.ok) throw new Error("Could not mark notifications read");
      await load();
    } catch {}
    setMarking(0);
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          load();
        }}
        aria-label="Notifications"
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-stone-200 bg-white text-stone-600 shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-white/5"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white ring-2 ring-white dark:ring-slate-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-4 right-4 top-[64px] z-50 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[330px] dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-stone-100 bg-orange-50/50 px-4 py-3 dark:border-white/5 dark:bg-orange-500/10">
              <p className="text-sm font-black text-stone-900 dark:text-slate-100">
                Notifications
                {unread > 0 && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black text-red-600 dark:bg-red-500/15 dark:text-red-400">
                    {unread} new
                  </span>
                )}
              </p>
              <span className="flex items-center gap-2.5">
                {unread > 0 && (
                  <button
                    onClick={() => void markAllRead()}
                    disabled={marking !== 0}
                    className="flex items-center gap-1 text-xs font-black text-stone-500 transition hover:text-emerald-600 disabled:opacity-50 dark:text-slate-400 dark:hover:text-emerald-400"
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                )}
                <Link
                  href={allLink}
                  onClick={() => setOpen(false)}
                  className={`text-xs font-black ${dark ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}
                >
                  View all
                </Link>
              </span>
            </div>
            <div className="max-h-[55vh] overflow-y-auto sm:max-h-[340px]">
              {items.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-stone-400 dark:text-slate-500">
                  All quiet here. Time to book a game! ⚽
                </p>
              )}
              {items.map((n) => (
                <div key={n.id} className="border-b border-stone-50 py-1 last:border-0 dark:border-white/5">
                  <SwipeNotificationRow
                    notification={n}
                    typeClass=""
                    owner={isOwner}
                    onOpen={openNotification}
                    onRead={markRead}
                    onDelete={remove}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
