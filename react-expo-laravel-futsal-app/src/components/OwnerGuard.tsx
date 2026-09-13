"use client";

import Link from "next/link";
import { Crown, LogIn } from "lucide-react";
import { useUser } from "./UserProvider";
import type { ReactNode } from "react";

export function OwnerGuard({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useUser();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-900 dark:ring-1 dark:ring-white/20">
          <Crown className="h-8 w-8 text-amber-400" />
        </span>
        <h1 className="mt-4 text-2xl font-black tracking-tight">Owner sign-in required</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Owner Studio is exclusive to venue owners. Log in with an owner
          account or create one to list your arena.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            <LogIn className="h-4 w-4" /> Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-slate-900 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-900"
          >
            Sign up free
          </Link>
        </div>
      </div>
    );
  }

  if (user.role !== "owner") {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-3xl dark:bg-slate-800">
          👑
        </span>
        <h1 className="mt-4 text-2xl font-black tracking-tight">Owners only</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          You&apos;re signed in as <b className="text-slate-900 dark:text-slate-100">{user.name}</b>{" "}
          (player). Owner Studio needs a venue-owner account.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              logout();
              window.location.href = "/signup";
            }}
            className="rounded-xl bg-slate-900 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-900"
          >
            Become an owner
          </button>
          <Link
            href="/venues"
            className="rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            Book as player
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
