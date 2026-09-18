"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck, XCircle } from "lucide-react";
import { formatNPR } from "@/lib/futsal";

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const pidx = params.get("pidx") ?? "";
  const bookingId = params.get("bookingId") ?? "";
  // League entries check out here too, carrying league + squad instead of a
  // booking.
  const leagueId = params.get("leagueId") ?? "";
  const teamId = params.get("teamId") ?? "";
  const amount = Number(params.get("amount") ?? 0);
  const fallback = params.get("fallback") ?? "";
  const isLeague = !!leagueId && !!teamId;
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [error, setError] = useState("");

  async function pay() {
    setBusy("pay");
    setError("");
    try {
      const res = await fetch(
        isLeague ? `/api/tournaments/${leagueId}/payments` : "/api/payments/khalti/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isLeague
              ? {
                  action: "verify",
                  mockApprove: true,
                  userId: Number(params.get("userId") ?? 0),
                  teamId: Number(teamId),
                  amount,
                  method: "Khalti",
                }
              : { pidx, bookingId: Number(bookingId), mockApprove: true }
          ),
        }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Mock payment failed");
      if (isLeague) {
        router.push(`/leagues/${leagueId}?paid=1`);
        return;
      }
      router.push(`/payment/khalti/callback?pidx=${encodeURIComponent(pidx)}&bookingId=${bookingId}&status=Completed&mock=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(null);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#3b1d5e] px-4 py-12">
      <div className="w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="bg-[#5c2d91] p-6 text-center text-white">
          <p className="text-2xl font-black italic">Khalti</p>
          <p className="mt-1 rounded-full bg-white/20 px-3 py-1 text-[11px] font-black uppercase tracking-widest">
            Sandbox simulator • test mode
          </p>
        </div>
        <div className="space-y-3 p-6">
          <div className="rounded-2xl bg-purple-50 p-4 text-center">
            <p className="text-[11px] font-bold uppercase tracking-widest text-purple-500">Paying to FutsalNepal test store</p>
            <p className="mt-1 text-3xl font-black text-purple-900">{formatNPR(Number.isFinite(amount) ? amount : 0)}</p>
            <p className="mt-1 font-mono text-[11px] text-purple-400">pidx: {pidx.slice(0, 24)}… • booking #{bookingId}</p>
          </div>
          {fallback && (
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11px] font-bold text-amber-700">
              Real sandbox unreachable ({fallback.slice(0, 120)}). Simulator keeps your demo flowing — add KHALTI_SECRET_KEY for the live test page.
            </p>
          )}
          <div className="rounded-2xl border border-dashed border-purple-200 bg-white p-3 text-[11px] text-stone-500">
            Test wallet: <b>9800000001</b> • MPIN <b>1111</b> • OTP <b>987654</b>
            <span className="mt-1 block">This simulator skips OTP — just hit Pay to complete.</span>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600">{error}</p>}
          <button
            onClick={pay}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#5c2d91] py-3.5 text-sm font-black text-white disabled:opacity-50"
          >
            {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy === "pay" ? "Processing…" : `Pay ${formatNPR(Number.isFinite(amount) ? amount : 0)}`}
          </button>
          <button
            onClick={() => router.push(`/payment/khalti/callback?pidx=${encodeURIComponent(pidx)}&bookingId=${bookingId}&status=User%20canceled`)}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-stone-200 py-3 text-sm font-black text-stone-500"
          >
            <XCircle className="h-4 w-4" /> Cancel payment
          </button>
          <p className="text-center text-[11px] text-stone-400">
            Want the real page? Set <span className="font-mono font-bold">KHALTI_SECRET_KEY</span> from test-admin.khalti.com → you&apos;ll redirect to test-pay.khalti.com instead. •{" "}
            <Link href="/bookings" className="underline">Back to bookings</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function KhaltiMockPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center">Loading…</main>}>
      <Inner />
    </Suspense>
  );
}
