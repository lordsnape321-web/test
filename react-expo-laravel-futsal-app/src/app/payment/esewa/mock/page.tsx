"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck, XCircle } from "lucide-react";
import { formatNPR } from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const bookingId = params.get("bookingId") ?? "";
  // A league entry pays through the same checkout — it just carries league and
  // squad ids instead of a booking id, and settles on the league page.
  const leagueId = params.get("leagueId") ?? "";
  const teamId = params.get("teamId") ?? "";
  const amount = Number(params.get("amount") ?? 0);
  const uuid = params.get("uuid") ?? "";
  const reason = params.get("reason") ?? "";
  const isLeague = !!leagueId && !!teamId;
  const [busy, setBusy] = useState<"pay" | null>(null);
  const [error, setError] = useState("");

  async function pay() {
    setBusy("pay");
    setError("");
    try {
      const res = await apiFetch(
        isLeague ? `/api/tournaments/${leagueId}/payments` : "/api/payments/esewa/verify",
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
                  method: "eSewa",
                }
              : { mockApprove: true, bookingId: Number(bookingId) }
          ),
        }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Mock payment failed");
      if (isLeague) {
        router.push(`/leagues/${leagueId}?paid=1`);
        return;
      }
      router.push(`/payment/esewa/success?mock=1&bookingId=${bookingId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(null);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#0b6b3c] px-4 py-12">
      <div className="w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="bg-[#087443] p-6 text-center text-white">
          <p className="text-2xl font-black">
            e<span className="text-[#8ee6a8]">Sewa</span>
          </p>
          <p className="mt-1 rounded-full bg-white/20 px-3 py-1 text-[11px] font-black uppercase tracking-widest">
            Sandbox simulator • test mode
          </p>
        </div>
        <div className="space-y-3 p-6">
          <div className="rounded-2xl bg-emerald-50 p-4 text-center">
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600">
              Paying to FutsalNepal test store
            </p>
            <p className="mt-1 text-3xl font-black text-emerald-900">
              {formatNPR(Number.isFinite(amount) ? amount : 0)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-emerald-500">
              {uuid ? `uuid: ${uuid.slice(0, 26)}… • ` : ""}
            {isLeague ? `league #${leagueId} • squad #${teamId}` : `booking #${bookingId}`}
            </p>
          </div>
          {reason && (
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11px] font-bold text-amber-700">
              Real eSewa test page wouldn&apos;t open ({reason.slice(0, 140)}). This simulator
              completes the same verified flow so your demo never gets stuck.
            </p>
          )}
          <div className="rounded-2xl border border-dashed border-emerald-200 bg-white p-3 text-[11px] text-stone-500">
            Test login: <b>9806800001</b> • pw <b>123456</b> • MPIN <b>1122</b> • token{" "}
            <b>123456</b>
            <span className="mt-1 block">Simulator skips OTP — just hit Pay to complete.</span>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600">{error}</p>}
          <button
            onClick={pay}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#087443] py-3.5 text-sm font-black text-white disabled:opacity-50"
          >
            {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy === "pay" ? "Processing…" : `Pay ${formatNPR(Number.isFinite(amount) ? amount : 0)}`}
          </button>
          <button
            onClick={() =>
              router.push(isLeague ? `/leagues/${leagueId}` : `/payment/esewa/failure?bookingId=${bookingId}`)
            }
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-stone-200 py-3 text-sm font-black text-stone-500"
          >
            <XCircle className="h-4 w-4" /> Cancel payment
          </button>
          <p className="text-center text-[11px] text-stone-400">
            The real page is rc-epay.esewa.com.np — if it refuses to connect, your network may be
            blocking it. • <Link href="/bookings" className="underline">Back to bookings</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function EsewaMockPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center">Loading…</main>}>
      <Inner />
    </Suspense>
  );
}
