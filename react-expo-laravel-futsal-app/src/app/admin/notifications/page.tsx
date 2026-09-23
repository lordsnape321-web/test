"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Trash2, ChevronRight } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { timeAgo } from "@/components/NotificationBell";
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
    const res = await apiFetch(`/api/notifications?userId=${user.id}`);
    const data = await res.json();
    setItems(data.notifications ?? []);
  }, [user]);

  useEffect(() => {
    (async () => {
      if (user) await load();
      setLoading(false);
    })();
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
    await apiFetch(`/api/notifications/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    });
    if (n.link) window.location.href = n.link;
    else load();
  }

  async function remove(id: number) {
    await apiFetch(`/api/notifications/${id}`, { method: "DELETE" });
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
            <div
              key={n.id}
              className={`flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-sm transition dark:bg-slate-900 ${
                n.isRead ? "border-slate-200 dark:border-slate-800" : "border-slate-900 ring-1 ring-slate-900 dark:border-white dark:ring-white"
              }`}
            >
              <span className={`mt-0.5 shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase ${TYPE_STYLE[n.type] ?? TYPE_STYLE.info}`}>
                {n.type.replace(/_/g, " ")}
              </span>
              <button onClick={() => markOne(n)} className="min-w-0 flex-1 text-left">
                <p className="text-sm font-extrabold leading-snug text-slate-900 dark:text-slate-100">
                  {!n.isRead && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />}
                  {n.title}
                </p>
                {n.message && (
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{n.message}</p>
                )}
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-slate-400 dark:text-slate-500">
                  {timeAgo(n.createdAt)}
                  {n.link && (
                    <span className="flex items-center gap-0.5 text-orange-600 dark:text-orange-400">
                      • Open <ChevronRight className="h-3 w-3" />
                    </span>
                  )}
                </p>
              </button>
              <button
                onClick={() => remove(n.id)}
                title="Delete"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500 dark:text-slate-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
