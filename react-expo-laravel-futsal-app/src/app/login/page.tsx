"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  Crown,
  Zap,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { validateEmail, firstError } from "@/lib/validation";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login } = useUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/seed", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && user) {
      router.replace(user.role === "owner" ? "/admin" : "/");
    }
  }, [user, loading, router]);

  async function submit(e?: React.FormEvent, demoEmail?: string, demoPass?: string) {
    e?.preventDefault();
    if (!demoEmail) {
      const errs: Record<string, string> = {};
      const em = validateEmail(email);
      if (em) errs.email = em;
      if (!password) errs.password = "Password is required 🔒";
      else if (password.length > 100) errs.password = "Password is too long";
      if (Object.keys(errs).length > 0) {
        setFieldErrors(errs);
        setError(firstError(...Object.values(errs)) ?? "Check your details 🙏");
        return;
      }
    }
    setFieldErrors({});
    setError("");
    setBusy(true);
    try {
      const u = await login(demoEmail ?? email.trim(), demoPass ?? password);
      router.push(u.role === "owner" ? "/admin" : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="turf-pattern grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-white/5"
        >
          <ChevronLeft className="h-4 w-4" /> Back home
        </Link>

        <div className="overflow-hidden rounded-[2rem] border border-[#F0E3CC] bg-white shadow-[0_24px_60px_rgba(180,120,60,0.15)] dark:border-white/10 dark:bg-stone-900">
          <div className="bg-gradient-to-br from-emerald-700 to-green-800 p-7 pb-6 text-center dark:from-emerald-900 dark:to-green-950">
            <span className="animate-wiggle mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-lg">
              <Trophy className="h-7 w-7 text-emerald-700" strokeWidth={2.5} />
            </span>
            <h1 className="mt-3 text-2xl font-black text-white">Welcome back, friend! 👋</h1>
            <p className="mt-1 text-sm text-emerald-100/80">
              Your crew saved you a spot — let&apos;s get you back on court
            </p>
          </div>

          <form onSubmit={(e) => submit(e)} noValidate className="space-y-3 p-6">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Email
              </span>
              <span className={`flex items-center gap-2 rounded-2xl border bg-[#FFF6E9] px-4 dark:bg-white/5 ${fieldErrors.email ? "border-red-400" : "border-stone-200 focus-within:border-emerald-500 dark:border-white/10"}`}>
                <Mail className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" />
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
                Password
              </span>
              <span className={`flex items-center gap-2 rounded-2xl border bg-[#FFF6E9] px-4 dark:bg-white/5 ${fieldErrors.password ? "border-red-400" : "border-stone-200 focus-within:border-emerald-500 dark:border-white/10"}`}>
                <Lock className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" />
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((p) => ({ ...p, password: "" }));
                  }}
                  placeholder="••••••••"
                  maxLength={100}
                  className="w-full bg-transparent py-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-stone-100 dark:placeholder:text-stone-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
              {fieldErrors.password && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.password}</span>}
            </label>

            {error && (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {busy ? "Getting you in…" : "Log in & play"}
            </button>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-stone-200 dark:bg-white/10" />
              <span className="text-[11px] font-black uppercase tracking-widest text-stone-400 dark:text-stone-500">
                Just looking around?
              </span>
              <span className="h-px flex-1 bg-stone-200 dark:bg-white/10" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => submit(undefined, "aarav@futsal.np", "futsal123")}
                className="flex items-center justify-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 py-3 text-xs font-black text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
              >
                <Zap className="h-4 w-4" /> Try as Player
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => submit(undefined, "ganesh@futsal.np", "futsal123")}
                className="flex items-center justify-center gap-1.5 rounded-2xl border border-orange-200 bg-orange-50 py-3 text-xs font-black text-orange-700 transition hover:bg-orange-100 disabled:opacity-50 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300 dark:hover:bg-orange-500/20"
              >
                <Crown className="h-4 w-4" /> Try as Owner
              </button>
            </div>

            <p className="text-center text-sm">
              <Link href="/forgot-password" className="font-bold text-orange-600 hover:text-orange-500 dark:text-orange-400">
                Forgot your password? 🔑
              </Link>
            </p>
            <p className="pt-1 text-center text-sm text-stone-500 dark:text-stone-400">
              New to the family?{" "}
              <Link href="/signup" className="font-black text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">
                Join us — it&apos;s free
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
