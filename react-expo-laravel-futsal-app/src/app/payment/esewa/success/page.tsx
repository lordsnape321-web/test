"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, PartyPopper, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

function Inner() {
  const params = useSearchParams();
  const [state, setState] = useState<"verifying" | "ok" | "fail">("verifying");
  const [msg, setMsg] = useState("");
  const [bookingId, setBookingId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const data = params.get("data") ?? "";
      const hint = params.get("bookingId") ?? params.get("booking_id") ?? "";
      const teamPaymentId = params.get("teamPaymentId") ?? "";
      const paymentRequestId = params.get("paymentRequestId") ?? "";
      const userId = params.get("userId") ?? "";
      const isMock = params.get("mock") === "1";
      if (isMock && hint) {
        // Came from the local simulator, already verified server-side.
        setBookingId(Number(hint));
        setState("ok");
        return;
      }
      if (!data) {
        setState("fail");
        setMsg("Missing eSewa response. If you paid, check My Bookings — it may already be verified. 🙏");
        return;
      }
      try {
        const res = await apiFetch("/api/payments/esewa/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data,
            bookingId: hint ? Number(hint) : undefined,
            teamPaymentId: teamPaymentId ? Number(teamPaymentId) : undefined,
            paymentRequestId: paymentRequestId ? Number(paymentRequestId) : undefined,
            userId: userId ? Number(userId) : undefined,
          }),
        });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || "Verification failed");
        setBookingId(j.booking?.id ?? (hint ? Number(hint) : null));
        setState("ok");
      } catch (e) {
        setState("fail");
        setMsg(e instanceof Error ? e.message : "Verification failed");
        const hb = params.get("bookingId");
        if (hb) setBookingId(Number(hb));
      }
    })();
  }, [params]);

  return (
    <main className="turf-pattern grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md rounded-[2rem] border border-[#F0E3CC] bg-white p-8 text-center shadow-lg dark:border-white/10 dark:bg-slate-900">
        {state === "verifying" && (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-emerald-600" />
            <h1 className="mt-4 text-xl font-black">Verifying eSewa payment… 💚</h1>
            <p className="mt-2 text-sm text-stone-500">Talking to eSewa test server — hold tight!</p>
          </>
        )}
        {state === "ok" && (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 shadow-lg">
              <PartyPopper className="h-8 w-8 text-white" />
            </span>
            <h1 className="mt-4 text-xl font-black">Payment verified! 🎉</h1>
            <p className="mt-2 text-sm text-stone-500">
              eSewa test payment confirmed{bookingId ? <> for booking <b>#FN-{bookingId}</b></> : ""}. The venue will review your request next! ⚽
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
            <h1 className="mt-4 text-xl font-black">Couldn&apos;t verify 😢</h1>
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

export default function EsewaSuccessPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center">Verifying…</main>}>
      <Inner />
    </Suspense>
  );
}
