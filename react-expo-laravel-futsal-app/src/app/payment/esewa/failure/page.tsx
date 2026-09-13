"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { XCircle } from "lucide-react";

function Inner() {
  const params = useSearchParams();
  const bookingId = params.get("bookingId");
  return (
    <main className="turf-pattern grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md rounded-[2rem] border border-[#F0E3CC] bg-white p-8 text-center shadow-lg dark:border-white/10 dark:bg-stone-900">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-500 shadow-lg">
          <XCircle className="h-8 w-8 text-white" />
        </span>
        <h1 className="mt-4 text-xl font-black">eSewa payment cancelled 😌</h1>
        <p className="mt-2 text-sm text-stone-500">
          No money moved. Your booking {bookingId ? <b>#FN-{bookingId}</b> : ""} is still waiting —
          pay from My Bookings whenever you&apos;re ready, or switch to cash.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link href="/bookings" className="rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white">
            Pay from bookings
          </Link>
          <Link href="/venues" className="rounded-2xl border border-stone-200 py-3 text-sm font-black dark:border-white/10">
            Browse courts
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function EsewaFailurePage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center">Loading…</main>}>
      <Inner />
    </Suspense>
  );
}
