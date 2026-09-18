"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";
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
  /** Which row is being ticked off — 0 for none, -1 for "all of them". */
  const [marking, setMarking] = useState(0);
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

  /** Tick one off without leaving the page — the dot goes, the bell count drops. */
  async function markRead(id: number) {
    setMarking(id);
    setItems((list) => list.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnread((c) => Math.max(0, c - 1));
    try {
      await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      await load();
    } catch {}
    setMarking(0);
  }

  /** The whole lot at once — what you want after a week away. */
  async function markAllRead() {
    const uid = user?.id ?? 0;
    if (!uid) return;
    setMarking(-1);
    setItems((list) => list.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    try {
      await fetch(`/api/notifications/read-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid }),
      });
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
              <span className="flex items-center gap-2.5">
                {unread > 0 && (
                  <button
                    onClick={() => void markAllRead()}
                    disabled={marking !== 0}
                    className="flex items-center gap-1 text-xs font-black text-stone-500 transition hover:text-emerald-600 disabled:opacity-50 dark:text-stone-400 dark:hover:text-emerald-400"
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
                <p className="px-4 py-8 text-center text-sm text-stone-400 dark:text-stone-500">
                  All quiet here. Time to book a game! ⚽
                </p>
              )}
              {items.map((n) => (
                // A row holds two actions — open it, or just tick it off — and a
                // button inside a button is invalid HTML, so the tick sits beside
                // the row rather than within it.
                <div key={n.id} className="relative border-b border-stone-50 last:border-0 dark:border-white/5">
                  <button
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
                    className={`block w-full py-3 pl-4 pr-11 text-left transition hover:bg-orange-50/60 dark:hover:bg-orange-500/10 ${
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
                  {!n.isRead && (
                    <button
                      onClick={() => void markRead(n.id)}
                      disabled={marking !== 0}
                      title="Mark as read"
                      aria-label={`Mark "${n.title}" as read`}
                      className="absolute right-2.5 top-3 grid h-7 w-7 place-items-center rounded-lg text-stone-400 transition hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-50 dark:text-stone-500 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-300"
                    >
                      {marking === n.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
