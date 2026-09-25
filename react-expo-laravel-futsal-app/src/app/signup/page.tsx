"use client";
import { ThemedSelect } from "@/components/ThemedSelect";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Mail,
  Lock,
  User as UserIcon,
  Phone,
  Eye,
  EyeOff,
  ChevronLeft,
  Loader2,
  Zap,
  Crown,
  Check,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { validateName, validateEmail, validatePhone, validatePassword, passwordStrength, validateCity, firstError } from "@/lib/validation";
import { CITY_OPTIONS } from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

const POSITIONS = ["Striker", "Midfielder", "Winger", "Defender", "Goalkeeper", "Pivot", "All-rounder"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];

export default function SignupPage() {
  const router = useRouter();
  const { user, loading, signup } = useUser();
  const [role, setRole] = useState<"player" | "owner">("player");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [level, setLevel] = useState("Intermediate");
  const [position, setPosition] = useState("All-rounder");
  const [defaultCity, setDefaultCity] = useState("Kathmandu");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  useEffect(() => {
    apiFetch("/api/seed", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && user) {
      router.replace(user.role === "owner" ? "/admin" : "/");
    }
  }, [user, loading, router]);

  function validateAll() {
    const errs: Record<string, string> = {};
    const n = validateName(name);
    if (n) errs.name = n;
    const e = validateEmail(email);
    if (e) errs.email = e;
    const p = validatePhone(phone, { required: true });
    if (p) errs.phone = p;
    const pw = validatePassword(password);
    if (pw) errs.password = pw;
    const c = validateCity(defaultCity, "Home city");
    if (c) errs.defaultCity = c;
    return errs;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateAll();
    setFieldErrors(errs);
    setTouched({ name: true, email: true, phone: true, password: true, defaultCity: true });
    if (Object.keys(errs).length > 0) {
      setError(firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const u = await signup({ name: name.trim(), email: email.trim(), phone: phone.trim(), password, role, level, position, defaultCity });
      router.push(u.role === "owner" ? "/admin" : "/venues");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  const inputWrap = (bad: boolean) =>
    `flex items-center gap-2 rounded-2xl border bg-[#FFF6E9] px-4 dark:bg-white/5 ${
      bad ? "border-red-400" : "border-stone-200 focus-within:border-emerald-500 dark:border-white/10"
    }`;

  return (
    <main className="turf-pattern grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5"
        >
          <ChevronLeft className="h-4 w-4" /> Back home
        </Link>

        <div className="overflow-hidden rounded-[2rem] border border-[#F0E3CC] bg-white shadow-[0_24px_60px_rgba(180,120,60,0.15)] dark:border-white/10 dark:bg-slate-900">
          <div className="bg-gradient-to-br from-emerald-700 to-green-800 p-7 pb-6 text-center dark:from-emerald-900 dark:to-green-950">
            <span className="animate-wiggle mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-lg">
              <Trophy className="h-7 w-7 text-emerald-700" strokeWidth={2.5} />
            </span>
            <h1 className="mt-3 text-2xl font-black text-white">Come join the family ⚽</h1>
            <p className="mt-1 text-sm text-emerald-100/80">
              Free forever for players — tell us a little about yourself
            </p>
          </div>

          <form onSubmit={submit} noValidate className="space-y-3 p-6">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole("player")}
                className={`relative rounded-2xl border p-3.5 text-left transition ${
                  role === "player"
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                    : "border-stone-200 bg-stone-50 hover:border-stone-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                }`}
              >
                {role === "player" && (
                  <span className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-emerald-600">
                    <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                  </span>
                )}
                <Zap className={`h-5 w-5 ${role === "player" ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400 dark:text-slate-500"}`} />
                <p className="mt-1.5 text-sm font-black text-stone-900 dark:text-slate-100">I want to play</p>
                <p className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
                  Book courts, join games & teams
                </p>
              </button>
              <button
                type="button"
                onClick={() => setRole("owner")}
                className={`relative rounded-2xl border p-3.5 text-left transition ${
                  role === "owner"
                    ? "border-orange-500 bg-orange-50 dark:bg-orange-500/10"
                    : "border-stone-200 bg-stone-50 hover:border-stone-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                }`}
              >
                {role === "owner" && (
                  <span className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-orange-500">
                    <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                  </span>
                )}
                <Crown className={`h-5 w-5 ${role === "owner" ? "text-orange-500 dark:text-orange-400" : "text-stone-400 dark:text-slate-500"}`} />
                <p className="mt-1.5 text-sm font-black text-stone-900 dark:text-slate-100">I own a court</p>
                <p className="text-[11px] leading-snug text-stone-500 dark:text-slate-400">
                  Welcome players, grow bookings
                </p>
              </button>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                What should we call you?
              </span>
              <span className={inputWrap(!!fieldErrors.name && touched.name)}>
                <UserIcon className="h-4 w-4 shrink-0 text-stone-400 dark:text-slate-500" />
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldErrors((p) => ({ ...p, name: "" }));
                  }}
                  onBlur={() => {
                    setTouched((p) => ({ ...p, name: true }));
                    const v = validateName(name);
                    setFieldErrors((p) => ({ ...p, name: v ?? "" }));
                  }}
                  placeholder="Your name"
                  maxLength={60}
                  className="w-full bg-transparent py-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </span>
              {fieldErrors.name && touched.name ? (
                <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.name}</span>
              ) : (
                <span className="mt-1 block text-[11px] text-stone-400">{name.trim().length}/60</span>
              )}
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                  Email
                </span>
                <span className={inputWrap(!!fieldErrors.email && touched.email)}>
                  <Mail className="h-4 w-4 shrink-0 text-stone-400 dark:text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldErrors((p) => ({ ...p, email: "" }));
                    }}
                    onBlur={() => {
                      setTouched((p) => ({ ...p, email: true }));
                      const v = validateEmail(email);
                      setFieldErrors((p) => ({ ...p, email: v ?? "" }));
                    }}
                    placeholder="you@mail.com"
                    maxLength={100}
                    className="w-full bg-transparent py-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </span>
                {fieldErrors.email && touched.email && (
                  <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.email}</span>
                )}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                  Phone (one account per number)
                </span>
                <span className={inputWrap(!!fieldErrors.phone && touched.phone)}>
                  <Phone className="h-4 w-4 shrink-0 text-stone-400 dark:text-slate-500" />
                  <input
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setFieldErrors((p) => ({ ...p, phone: "" }));
                    }}
                    onBlur={() => {
                      setTouched((p) => ({ ...p, phone: true }));
                      const v = validatePhone(phone, { required: true });
                      setFieldErrors((p) => ({ ...p, phone: v ?? "" }));
                    }}
                    placeholder="98XXXXXXXX"
                    maxLength={16}
                    inputMode="tel"
                    className="w-full bg-transparent py-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </span>
                {fieldErrors.phone && touched.phone && (
                  <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.phone}</span>
                )}
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                Pick a password (min 6 chars)
              </span>
              <span className={inputWrap(!!fieldErrors.password && touched.password)}>
                <Lock className="h-4 w-4 shrink-0 text-stone-400 dark:text-slate-500" />
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((p) => ({ ...p, password: "" }));
                  }}
                  onBlur={() => {
                    setTouched((p) => ({ ...p, password: true }));
                    const v = validatePassword(password);
                    setFieldErrors((p) => ({ ...p, password: v ?? "" }));
                  }}
                  placeholder="Something you'll remember"
                  maxLength={100}
                  className="w-full bg-transparent py-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="text-stone-400 hover:text-stone-700 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
              {password && (
                <span className="mt-1.5 block">
                  <span className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          i <= strength.score ? (strength.score <= 1 ? "bg-red-400" : strength.score === 2 ? "bg-amber-400" : "bg-emerald-500") : "bg-stone-200 dark:bg-white/10"
                        }`}
                      />
                    ))}
                  </span>
                  <span className="mt-1 block text-[11px] font-bold text-stone-500">
                    {strength.emoji} {strength.label}
                    {strength.tips.length > 0 && password.length >= 6 ? ` • try: ${strength.tips.slice(0, 2).join(", ")}` : ""}
                  </span>
                </span>
              )}
              {fieldErrors.password && touched.password && (
                <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.password}</span>
              )}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                Home city 🏠 — your search starts here
              </span>
              <ThemedSelect
                value={defaultCity}
                onChange={(e) => setDefaultCity(e.target.value)}
                className="w-full rounded-2xl border border-stone-200 bg-[#FFF6E9] px-4 py-3 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
              >
                {CITY_OPTIONS.filter((c) => c !== "All Cities").map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </ThemedSelect>
            </label>

            {role === "player" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                    Your level
                  </span>
                  <ThemedSelect
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full rounded-2xl border border-stone-200 bg-[#FFF6E9] px-4 py-3 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
                  >
                    {LEVELS.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </ThemedSelect>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                    Favourite spot
                  </span>
                  <ThemedSelect
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className="w-full rounded-2xl border border-stone-200 bg-[#FFF6E9] px-4 py-3 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
                  >
                    {POSITIONS.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </ThemedSelect>
                </label>
              </div>
            )}

            {error && (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white shadow-md transition disabled:opacity-50 ${
                role === "owner"
                  ? "bg-orange-500 hover:bg-orange-600"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy
                ? "Setting things up…"
                : role === "owner"
                  ? "List my court 🎉"
                  : "Join & start playing 🎉"}
            </button>

            <p className="pt-1 text-center text-sm text-stone-500 dark:text-slate-400">
              Already part of the family?{" "}
              <Link href="/login" className="font-black text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">
                Log in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
