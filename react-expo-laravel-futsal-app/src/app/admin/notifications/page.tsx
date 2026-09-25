"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { SwipeNotificationRow } from "@/components/SwipeNotificationRow";
import { useUser } from "@/components/UserProvider";
import { apiFetch } from "@/lib/api";

type N = {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string | null;
};

const TYPE_STYLE: Record<string, string> = {
  booking_request: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  booking_confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  booking_rejected: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  booking_cancelled: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  payment: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  match_join: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  free_play: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  review: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  info: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export default function OwnerNotificationsPage() {
  const { user } = useUser();
  const [items, setItems] = useState<N[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/api/notifications?userId=${user.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
    } catch {
      // Keep the last database-confirmed inbox visible during a brief outage.
    }
  }, [user]);

  useEffect(() => {
    (async () => {
      if (user) await load();
      setLoading(false);
    })();
  }, [user, load]);

  // Keep the request/payment inbox live while it is open.
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [user, load]);

  async function markAll() {
    if (!user) return;
    await apiFetch("/api/notifications/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    load();
  }

  async function markOne(n: N) {
    const res = await apiFetch(`/api/notifications/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    });
    if (!res.ok) throw new Error("Could not mark notification read");
    if (n.link) window.location.href = n.link;
    else load();
  }

  async function markReadOnly(n: N) {
    if (n.isRead) return;
    const res = await apiFetch(`/api/notifications/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    });
    if (!res.ok) throw new Error("Could not mark notification read");
    setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item)));
  }

  async function remove(id: number) {
    const res = await apiFetch(`/api/notifications/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Could not delete notification");
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  const unread = items.filter((x) => !x.isRead).length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <Bell className="h-6 w-6" /> Notifications
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {unread > 0 ? `${unread} unread updates` : "You're all caught up"} — requests, cancellations & payments.
          </p>
        </div>
        {unread > 0 && (
          <button
            onClick={markAll}
            className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="mt-5 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <Bell className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 text-lg font-extrabold">No notifications</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            New booking requests from players will land here instantly.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-2.5">
          {items.map((n) => (
            <SwipeNotificationRow
              key={n.id}
              notification={n}
              typeClass={TYPE_STYLE[n.type] ?? TYPE_STYLE.info}
              owner
              onOpen={markOne}
              onRead={markReadOnly}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
