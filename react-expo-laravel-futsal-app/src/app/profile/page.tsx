"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  User as UserIcon,
  Phone,
  Lock,
  Check,
  Loader2,
  LogIn,
  PartyPopper,
  Eye,
  EyeOff,
  Gift,
  MapPin,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { PlayerRatingCard } from "@/components/PlayerRating";
import { AvatarUploader } from "@/components/AvatarUploader";
import { CITY_OPTIONS } from "@/lib/futsal";
import { monthLabel, type PlayerStats } from "@/lib/loyalty";
import { validateName, validatePhone, validatePassword, passwordStrength, firstError } from "@/lib/validation";
import { apiFetch } from "@/lib/api";

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#f59e0b"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const POSITIONS = ["Striker", "Midfielder", "Winger", "Defender", "Goalkeeper", "Pivot", "All-rounder"];

const SELECT_CLS =
  "w-full rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100";

export default function PlayerProfilePage() {
  const { user, loading: authLoading, updateProfile } = useUser();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [level, setLevel] = useState("Intermediate");
  const [position, setPosition] = useState("All-rounder");
  const [color, setColor] = useState(COLORS[0]);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [defaultCity, setDefaultCity] = useState("All Cities");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [vouchers, setVouchers] = useState<Array<{ id: number; code: string; status: string; month: string; venue: { id: number; name: string; imageUrl: string } | null }>>([]);
  const [progress, setProgress] = useState<Array<{ venueId: number; venueName: string; venueImage: string; count: number; target: number; remaining: number; done: boolean }>>([]);
  const [progressMonth, setProgressMonth] = useState("");

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone);
      setLevel(user.level);
      setPosition(user.position);
      setColor(user.avatarColor);
      setAvatarUrl((user as { avatarUrl?: string }).avatarUrl ?? "");
      setDefaultCity((user as { defaultCity?: string }).defaultCity ?? "All Cities");
      (async () => {
        try {
          const [sRes, vRes] = await Promise.all([
            apiFetch(`/api/users/${user.id}`),
            apiFetch(`/api/vouchers?userId=${user.id}`),
          ]);
          const sData = await sRes.json();
          const vData = await vRes.json();
          if (sData.stats) setStats(sData.stats);
          setVouchers(vData.vouchers ?? []);
          setProgress(vData.progress ?? []);
          setProgressMonth(vData.month ?? "");
        } catch {}
      })();
    }
  }, [user]);

  async function saveProfile() {
    if (!user) return;
    const errs: Record<string, string> = {};
    const nErr = validateName(name);
    if (nErr) errs.name = nErr;
    const pErr = validatePhone(phone, { required: true });
    if (pErr) errs.phone = pErr;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setMsg({ ok: false, text: firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏" });
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setMsg(null);
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim(), level, position, avatarColor: color, avatarUrl, defaultCity } as Parameters<typeof updateProfile>[0]);
      setMsg({ ok: true, text: "Looking good! Your profile is updated. ✨" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save" });
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (!user) return;
    if (!currentPw) {
      setPwMsg({ ok: false, text: "Current password is required 🔒" });
      return;
    }
    const npErr = validatePassword(newPw, { label: "New password" });
    if (npErr) {
      setPwMsg({ ok: false, text: npErr });
      return;
    }
    if (currentPw === newPw) {
      setPwMsg({ ok: false, text: "New password must be different from the old one 🔄" });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setPwMsg({ ok: true, text: "Password changed! You're all secure. 🔒" });
      setCurrentPw("");
      setNewPw("");
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't change" });
    } finally {
      setPwSaving(false);
    }
  }

  const newPwStrength = passwordStrength(newPw);

  if (!authLoading && !user) {
    return (
      <main className="turf-pattern grid min-h-screen place-items-center px-4 py-12">
        <div className="w-full max-w-md rounded-[2rem] border border-[#F0E3CC] bg-white p-8 text-center shadow-lg dark:border-white/10 dark:bg-slate-900">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-600">
            <UserIcon className="h-8 w-8 text-white" />
          </span>
          <h1 className="mt-4 text-2xl font-black text-stone-900 dark:text-slate-100">Your profile awaits 🌟</h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-slate-400">Log in to style your player card.</p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Link href="/login" className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white">
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

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
          <PartyPopper className="h-3.5 w-3.5" /> Make it yours
        </p>
        <h1 className="mt-1 text-3xl font-black text-stone-900 dark:text-slate-100">My profile</h1>

        {stats && (
          <div className="mt-5">
            <PlayerRatingCard stats={stats} />
          </div>
        )}

        {(vouchers.length > 0 || progress.length > 0) && (
          <div className="mt-4 rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-violet-600 dark:text-violet-400">
              <Gift className="h-4 w-4" /> Loyalty rewards 🎁
            </h2>
            <p className="mt-1 text-xs text-stone-500 dark:text-slate-400">
              Play 7 games at the same futsal in {progressMonth ? monthLabel(progressMonth) : "a month"} → earn a FREE hour! ⚽
            </p>
            {vouchers.filter((v) => v.status === "active").length > 0 && (
              <div className="mt-3 space-y-2">
                {vouchers.filter((v) => v.status === "active").map((v) => (
                  <div key={v.id} className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 p-3.5 text-white shadow-md">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20 text-2xl">🎁</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black">FREE 1 hour at {v.venue?.name ?? "futsal"}!</p>
                      <p className="font-mono text-[11px] text-white/80">{v.code} • pick it at booking 🎉</p>
                    </div>
                    <Link href="/venues" className="shrink-0 rounded-full bg-white px-3.5 py-2 text-[11px] font-black text-violet-700">
                      Use it →
                    </Link>
                  </div>
                ))}
              </div>
            )}
            {progress.length > 0 && (
              <div className="mt-3 space-y-2.5">
                {progress.map((p) => (
                  <div key={p.venueId} className="rounded-2xl bg-stone-50 p-3 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-2 text-xs font-black">
                      <span className="truncate">{p.venueName}</span>
                      <span className={p.done ? "text-emerald-600" : "text-stone-500"}>
                        {p.done ? "🎉 Reward earned!" : `${p.count}/${p.target} • ${p.remaining} to go`}
                      </span>
                    </div>
                    <div className="mt-1.5 flex gap-1">
                      {Array.from({ length: p.target }).map((_, i) => (
                        <span
                          key={i}
                          className={`h-2.5 flex-1 rounded-full ${i < p.count ? "bg-gradient-to-r from-violet-500 to-fuchsia-500" : "bg-stone-200 dark:bg-white/10"}`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {vouchers.filter((v) => v.status !== "active").length > 0 && (
              <p className="mt-2 text-[11px] text-stone-400">
                Used {vouchers.filter((v) => v.status !== "active").length} free hour{vouchers.filter((v) => v.status !== "active").length !== 1 ? "s" : ""} so far — nice! 💜
              </p>
            )}
          </div>
        )}

        {/* Avatar + photo */}
        <div className="mt-4 rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            <UserIcon className="h-4 w-4" /> Your look 📸
          </h2>
          <div className="mt-3">
            <AvatarUploader name={name || "?"} color={color} value={avatarUrl} onChange={setAvatarUrl} />
          </div>
          <div className="mt-4 min-w-0 border-t border-stone-100 pt-3 dark:border-white/5">
            <p className="truncate text-xl font-black text-stone-900 dark:text-slate-100">{name || "…"}</p>
            <p className="truncate text-sm text-stone-500 dark:text-slate-400">{user?.email}</p>
            <p className="mt-0.5 text-xs font-bold text-stone-400 dark:text-slate-500">
              ⚽ {level} • {position} • {user?.matchesPlayed ?? 0} games played
            </p>
          </div>
        </div>

        {/* Edit details */}
        <div className="mt-4 rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            <UserIcon className="h-4 w-4" /> About you
          </h2>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">Display name</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldErrors((p) => ({ ...p, name: "" }));
                }}
                maxLength={60}
                className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:outline-none dark:bg-white/5 dark:text-slate-100 ${
                  fieldErrors.name ? "border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                }`}
              />
              {fieldErrors.name ? (
                <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.name}</span>
              ) : (
                <span className="mt-1 block text-[11px] text-stone-400">{name.trim().length}/60</span>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                Phone (one account per number)
              </span>
              <span className={`flex items-center gap-2 rounded-xl border bg-[#FFF6E9] px-4 dark:bg-white/5 ${
                fieldErrors.phone ? "border-red-400" : "border-stone-200 focus-within:border-emerald-500 dark:border-white/10"
              }`}>
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
                  className="w-full bg-transparent py-2.5 text-sm font-semibold text-stone-900 focus:outline-none dark:text-slate-100"
                />
              </span>
              {fieldErrors.phone && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.phone}</span>}
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                <MapPin className="h-3.5 w-3.5" /> Home city — used for futsal search 🏠
              </span>
              <select value={defaultCity} onChange={(e) => setDefaultCity(e.target.value)} className={SELECT_CLS}>
                {CITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c === "All Cities" ? "No default — show all cities" : c}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-stone-400 dark:text-slate-500">
                Home tab search starts in {defaultCity === "All Cities" ? "all cities 🌍" : `${defaultCity} 📍`} — change anytime!
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">Level</span>
                <select value={level} onChange={(e) => setLevel(e.target.value)} className={SELECT_CLS}>
                  {LEVELS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">Position</span>
                <select value={position} onChange={(e) => setPosition(e.target.value)} className={SELECT_CLS}>
                  {POSITIONS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">Avatar colour (backup if no photo)</span>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    aria-label={c}
                    className={`grid h-9 w-9 place-items-center rounded-full transition ${
                      color === c ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900" : ""
                    }`}
                    style={{ background: c }}
                  >
                    {color === c && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
            {msg && (
              <p className={`rounded-xl px-4 py-3 text-xs font-bold ${msg.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"}`}>
                {msg.text}
              </p>
            )}
            <button
              onClick={saveProfile}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save my style ✨"}
            </button>
          </div>
        </div>

        {/* Change password */}
        <div className="mt-4 rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-orange-500 dark:text-orange-400">
            <Lock className="h-4 w-4" /> Change password
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">Current password</span>
              <input
                type={showPw ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-orange-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">New password</span>
              <span className="flex items-center gap-2 rounded-xl border border-stone-200 bg-[#FFF6E9] px-3.5 focus-within:border-orange-400 dark:border-white/10 dark:bg-white/5">
                <input
                  type={showPw ? "text" : "password"}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="Min 6 characters"
                  maxLength={100}
                  className="w-full bg-transparent py-2.5 text-sm font-semibold text-stone-900 focus:outline-none dark:text-slate-100"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="text-stone-400">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
              {newPw && (
                <span className="mt-1.5 block">
                  <span className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          i <= newPwStrength.score
                            ? newPwStrength.score <= 1
                              ? "bg-red-400"
                              : newPwStrength.score === 2
                                ? "bg-amber-400"
                                : "bg-emerald-500"
                            : "bg-stone-200 dark:bg-white/10"
                        }`}
                      />
                    ))}
                  </span>
                  <span className="mt-1 block text-[11px] font-bold text-stone-500">
                    {newPwStrength.emoji} {newPwStrength.label}
                    {newPwStrength.tips.length > 0 && newPw.length >= 6 ? ` • try: ${newPwStrength.tips.slice(0, 2).join(", ")}` : ""}
                  </span>
                </span>
              )}
            </label>
          </div>
          {pwMsg && (
            <p className={`mt-3 rounded-xl px-4 py-3 text-xs font-bold ${pwMsg.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"}`}>
              {pwMsg.text}
            </p>
          )}
          <button
            onClick={changePassword}
            disabled={pwSaving || !currentPw || !newPw}
            className="mt-3 w-full rounded-2xl bg-orange-500 py-3 text-sm font-black text-white shadow-md transition hover:bg-orange-600 disabled:opacity-40"
          >
            {pwSaving ? "Updating…" : "Update password 🔒"}
          </button>
        </div>
      </div>
    </main>
  );
}
