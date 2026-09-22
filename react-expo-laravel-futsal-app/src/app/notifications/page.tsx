"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Trash2, LogIn, ChevronRight, Heart } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { timeAgo } from "@/components/NotificationBell";

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
  // Squad traffic: join requests to answer, invitations to accept or decline.
  team: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  info: "bg-stone-200 text-stone-600 dark:bg-white/10 dark:text-slate-300",
};

export default function NotificationsPage() {
  const { user, loading: authLoading } = useUser();
  const [items, setItems] = useState<N[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const res = await fetch(`/api/notifications?userId=${user.id}`);
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
    await fetch("/api/notifications/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    load();
  }

  async function markOne(n: N) {
    await fetch(`/api/notifications/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    });
    if (n.link) window.location.href = n.link;
    else load();
  }

  async function remove(id: number) {
    await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  if (!authLoading && !user) {
    return (
      <main className="turf-pattern grid min-h-screen place-items-center px-4 py-12">
        <div className="w-full max-w-md rounded-[2rem] border border-[#F0E3CC] bg-white p-8 text-center shadow-lg dark:border-white/10 dark:bg-slate-900">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-orange-100 dark:bg-orange-500/15">
            <Bell className="h-8 w-8 text-orange-500" />
          </span>
          <h1 className="mt-4 text-2xl font-black text-stone-900 dark:text-slate-100">Your letters await 💌</h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-slate-400">
            Game confirmations, friend joins and little surprises land here.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Link href="/login" className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white shadow-md">
              <LogIn className="h-4 w-4" /> Log in
            </Link>
            <Link href="/signup" className="rounded-2xl border border-stone-200 py-3 text-sm font-black text-stone-700 dark:border-white/10 dark:text-slate-200">
              Join free
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const unread = items.filter((x) => !x.isRead).length;

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
              <Heart className="h-3.5 w-3.5" /> Little notes for you
            </p>
            <h1 className="mt-1 text-3xl font-black text-stone-900 dark:text-slate-100">
              Updates {unread > 0 && <span className="text-lg text-orange-500 dark:text-orange-400">({unread} fresh)</span>}
            </h1>
          </div>
          {unread > 0 && (
            <button
              onClick={markAll}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5"
            >
              <CheckCheck className="h-4 w-4" /> All caught up
            </button>
          )}
        </div>

        {loading ? (
          <div className="mt-6 space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center dark:border-white/20 dark:bg-slate-900">
            <Bell className="mx-auto h-10 w-10 text-stone-300 dark:text-slate-600" />
            <h3 className="mt-3 text-lg font-extrabold text-stone-900 dark:text-slate-100">All quiet, all good 🎉</h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-slate-400">
              Book a court or join a game — little joys will pop up here.
            </p>
            <Link href="/venues" className="mt-4 inline-block rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-black text-white shadow-md">
              Find a court
            </Link>
          </div>
        ) : (
          <div className="mt-6 space-y-2.5">
            {items.map((n) => (
              <div
                key={n.id}
                className={`group flex items-start gap-3 rounded-2xl border p-4 shadow-sm transition ${
                  n.isRead
                    ? "border-stone-200 bg-white dark:border-white/10 dark:bg-slate-900"
                    : "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                }`}
              >
                <span className={`mt-0.5 rounded-xl px-2.5 py-1.5 text-[10px] font-black uppercase ${TYPE_STYLE[n.type] ?? TYPE_STYLE.info}`}>
                  {!n.isRead ? "● " : ""}{n.type.replace(/_/g, " ")}
                </span>
                <button onClick={() => markOne(n)} className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-extrabold leading-snug text-stone-900 dark:text-slate-100">{n.title}</p>
                  {n.message && (
                    <p className="mt-1 text-[13px] leading-relaxed text-stone-500 dark:text-slate-400">
                      {n.message}
                    </p>
                  )}
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-stone-400 dark:text-slate-500">
                    {timeAgo(n.createdAt)}
                    {n.link && (
                      <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                        • Have a look <ChevronRight className="h-3 w-3" />
                      </span>
                    )}
                  </p>
                </button>
                <button
                  onClick={() => remove(n.id)}
                  title="Delete"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-stone-300 transition hover:bg-red-50 hover:text-red-500 dark:text-slate-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
