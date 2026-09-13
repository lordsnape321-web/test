"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, PartyPopper, XCircle } from "lucide-react";

function Inner() {
  const params = useSearchParams();
  const [state, setState] = useState<"verifying" | "ok" | "fail">("verifying");
  const [msg, setMsg] = useState("");
  const [bookingId, setBookingId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const pidx = params.get("pidx") ?? "";
      const status = params.get("status") ?? "";
      const txn = params.get("transaction_id") ?? "";
      const bid = params.get("bookingId") ? Number(params.get("bookingId")) : null;
      if (bid) setBookingId(bid);
      if (!pidx) {
        setState("fail");
        setMsg("Missing Khalti session. Check My Bookings for status. 🙏");
        return;
      }
      if (status && !["Completed", "Pending", "Initiated"].includes(status)) {
        setState("fail");
        setMsg(`Khalti says: ${status}. No money moved — try again from My Bookings 💜`);
        return;
      }
      try {
        const res = await fetch("/api/payments/khalti/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pidx, bookingId: bid, transaction_id: txn, status }),
        });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || "Verification failed");
        setBookingId(j.booking?.id ?? bid);
        setState("ok");
      } catch (e) {
        setState("fail");
        setMsg(e instanceof Error ? e.message : "Verification failed");
      }
    })();
  }, [params]);

  return (
    <main className="turf-pattern grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md rounded-[2rem] border border-[#F0E3CC] bg-white p-8 text-center shadow-lg dark:border-white/10 dark:bg-stone-900">
        {state === "verifying" && (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-purple-600" />
            <h1 className="mt-4 text-xl font-black">Verifying Khalti payment… 💜</h1>
            <p className="mt-2 text-sm text-stone-500">Checking with Khalti test server…</p>
          </>
        )}
        {state === "ok" && (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-purple-600 shadow-lg">
              <PartyPopper className="h-8 w-8 text-white" />
            </span>
            <h1 className="mt-4 text-xl font-black">Payment verified! 🎉</h1>
            <p className="mt-2 text-sm text-stone-500">
              Khalti test payment confirmed{bookingId ? <> for booking <b>#FN-{bookingId}</b></> : ""}. Venue review is next! ⚽
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Link href="/bookings" className="rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white">
                Track booking
              </Link>
              <Link href="/venues" className="rounded-2xl border border-stone-200 py-3 text-sm font-black dark:border-white/10">
                Book more
              </Link>
            </div>
          </>
        )}
        {state === "fail" && (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-red-500 shadow-lg">
              <XCircle className="h-8 w-8 text-white" />
            </span>
            <h1 className="mt-4 text-xl font-black">Couldn't verify 😢</h1>
            <p className="mt-2 text-sm text-stone-500">{msg}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Link href="/bookings" className="rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white">
                My bookings
              </Link>
              <Link href="/venues" className="rounded-2xl border border-stone-200 py-3 text-sm font-black dark:border-white/10">
                Try again
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function KhaltiCallbackPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center">Verifying…</main>}>
      <Inner />
    </Suspense>
  );
}
