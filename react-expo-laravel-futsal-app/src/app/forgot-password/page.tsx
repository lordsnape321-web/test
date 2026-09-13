"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Mail, Phone, Lock, ChevronLeft, Loader2, Eye, EyeOff, PartyPopper } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { validateEmail, validatePhone, validatePassword, passwordStrength, firstError } from "@/lib/validation";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { user, loading } = useUser();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const strength = passwordStrength(newPw);

  useEffect(() => {
    if (!loading && user) router.replace(user.role === "owner" ? "/admin" : "/");
  }, [user, loading, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const em = validateEmail(email);
    if (em) errs.email = em;
    const ph = validatePhone(phone, { required: true });
    if (ph) errs.phone = ph;
    const pw = validatePassword(newPw, { label: "New password" });
    if (pw) errs.newPw = pw;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError(firstError(...Object.values(errs)) ?? "Check your details 🙏");
      return;
    }
    setFieldErrors({});
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="turf-pattern grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          href="/login"
          className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-white/5"
        >
          <ChevronLeft className="h-4 w-4" /> Back to login
        </Link>

        <div className="overflow-hidden rounded-[2rem] border border-[#F0E3CC] bg-white shadow-[0_24px_60px_rgba(180,120,60,0.15)] dark:border-white/10 dark:bg-stone-900">
          <div className="bg-gradient-to-br from-orange-500 to-amber-600 p-7 pb-6 text-center">
            <span className="animate-wiggle mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-lg">
              <KeyRound className="h-7 w-7 text-orange-600" strokeWidth={2.5} />
            </span>
            <h1 className="mt-3 text-2xl font-black text-white">Forgot your password? 🔑</h1>
            <p className="mt-1 text-sm text-orange-100">
              No stress — prove it&apos;s you with your email + phone, and pick a fresh one
            </p>
          </div>

          {done ? (
            <div className="space-y-3 p-6 text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 shadow-lg">
                <PartyPopper className="h-8 w-8 text-white" />
              </span>
              <h2 className="text-xl font-black text-stone-900 dark:text-stone-100">All set! 🎉</h2>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Your password is shiny and new. Log in and get back on court!
              </p>
              <Link
                href="/login"
                className="block w-full rounded-2xl bg-emerald-600 py-3.5 text-sm font-black text-white shadow-md transition hover:bg-emerald-700"
              >
                Go to login ⚽
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-3 p-6">
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Your account email
                </span>
                <span className={`flex items-center gap-2 rounded-2xl border bg-[#FFF6E9] px-4 dark:bg-white/5 ${fieldErrors.email ? "border-red-400" : "border-stone-200 focus-within:border-orange-400 dark:border-white/10"}`}>
                  <Mail className="h-4 w-4 shrink-0 text-stone-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldErrors((p) => ({ ...p, email: "" }));
                    }}
                    placeholder="you@example.com"
                    maxLength={100}
                    className="w-full bg-transparent py-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-stone-100 dark:placeholder:text-stone-500"
                  />
                </span>
                {fieldErrors.email && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.email}</span>}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Registered phone number
                </span>
                <span className={`flex items-center gap-2 rounded-2xl border bg-[#FFF6E9] px-4 dark:bg-white/5 ${fieldErrors.phone ? "border-red-400" : "border-stone-200 focus-within:border-orange-400 dark:border-white/10"}`}>
                  <Phone className="h-4 w-4 shrink-0 text-stone-400" />
                  <input
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setFieldErrors((p) => ({ ...p, phone: "" }));
                    }}
                    placeholder="98XXXXXXXX"
                    maxLength={16}
                    inputMode="tel"
                    className="w-full bg-transparent py-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-stone-100 dark:placeholder:text-stone-500"
                  />
                </span>
                {fieldErrors.phone && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.phone}</span>}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  New password (min 6 chars)
                </span>
                <span className={`flex items-center gap-2 rounded-2xl border bg-[#FFF6E9] px-4 dark:bg-white/5 ${fieldErrors.newPw ? "border-red-400" : "border-stone-200 focus-within:border-orange-400 dark:border-white/10"}`}>
                  <Lock className="h-4 w-4 shrink-0 text-stone-400" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={newPw}
                    onChange={(e) => {
                      setNewPw(e.target.value);
                      setFieldErrors((p) => ({ ...p, newPw: "" }));
                    }}
                    placeholder="Something memorable"
                    maxLength={100}
                    className="w-full bg-transparent py-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-stone-100 dark:placeholder:text-stone-500"
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="text-stone-400">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
                {newPw && (
                  <span className="mt-1.5 block">
                    <span className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= strength.score ? (strength.score <= 1 ? "bg-red-400" : strength.score === 2 ? "bg-amber-400" : "bg-emerald-500") : "bg-stone-200 dark:bg-white/10"}`} />
                      ))}
                    </span>
                    <span className="mt-1 block text-[11px] font-bold text-stone-500">{strength.emoji} {strength.label}</span>
                  </span>
                )}
                {fieldErrors.newPw && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.newPw}</span>}
              </label>

              {error && (
                <p className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 py-3.5 text-sm font-black text-white shadow-md transition hover:bg-orange-600 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Resetting…" : "Reset my password 🔑"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
