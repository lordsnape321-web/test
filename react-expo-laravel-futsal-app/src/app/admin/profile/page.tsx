"use client";

import { useEffect, useState } from "react";
import { User as UserIcon, Phone, Lock, Check, Loader2, Eye, EyeOff, Crown, MapPin } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { OwnerGuard } from "@/components/OwnerGuard";
import { AvatarUploader } from "@/components/AvatarUploader";
import { CITY_OPTIONS } from "@/lib/futsal";
import { validateName, validatePhone, validatePassword, passwordStrength, firstError } from "@/lib/validation";

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#f59e0b"];

export default function OwnerProfilePage() {
  const { user, updateProfile } = useUser();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone);
      setColor(user.avatarColor);
      setAvatarUrl((user as { avatarUrl?: string }).avatarUrl ?? "");
      setDefaultCity((user as { defaultCity?: string }).defaultCity ?? "All Cities");
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
      await updateProfile({ name: name.trim(), phone: phone.trim(), avatarColor: color, avatarUrl, defaultCity } as Parameters<typeof updateProfile>[0]);
      setMsg({ ok: true, text: "Profile updated! Players will see the new you. ✨" });
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
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setPwMsg({ ok: true, text: "Password changed! Your studio stays safe. 🔒" });
      setCurrentPw("");
      setNewPw("");
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't change" });
    } finally {
      setPwSaving(false);
    }
  }

  const newPwStrength = passwordStrength(newPw);

  return (
    <OwnerGuard>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Crown className="h-6 w-6 text-amber-500" /> My profile
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          How players and your team see you across Owner Studio.
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <AvatarUploader name={name || "?"} color={color} value={avatarUrl} onChange={setAvatarUrl} />
        <div className="mt-3 min-w-0 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="truncate text-xl font-black">{name || "…"}</p>
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
          <p className="mt-0.5 text-xs font-bold text-slate-400 dark:text-slate-500">
            👑 Venue Owner • {phone || "no phone yet"} • 📍 {defaultCity}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
            <UserIcon className="h-4 w-4 text-emerald-500" /> Studio identity
          </h2>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">Display name</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldErrors((p) => ({ ...p, name: "" }));
                }}
                maxLength={60}
                className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-semibold focus:outline-none dark:bg-slate-950 ${
                  fieldErrors.name ? "border-red-400" : "border-slate-200 focus:border-slate-900 dark:border-slate-700 dark:focus:border-white"
                }`}
              />
              {fieldErrors.name && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.name}</span>}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Phone (one account per number)
              </span>
              <span className={`flex items-center gap-2 rounded-xl border px-3.5 dark:bg-slate-950 ${
                fieldErrors.phone ? "border-red-400" : "border-slate-200 focus-within:border-slate-900 dark:border-slate-700 dark:focus-within:border-white"
              }`}>
                <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setFieldErrors((p) => ({ ...p, phone: "" }));
                  }}
                  placeholder="98XXXXXXXX"
                  maxLength={16}
                  inputMode="tel"
                  className="w-full bg-transparent py-2.5 text-sm font-semibold focus:outline-none"
                />
              </span>
              {fieldErrors.phone && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.phone}</span>}
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <MapPin className="h-3.5 w-3.5" /> Home city 🏠
              </span>
              <select
                value={defaultCity}
                onChange={(e) => setDefaultCity(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:focus:border-white [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
              >
                {CITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c === "All Cities" ? "No default — show all cities" : c}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">Avatar colour (backup if no photo)</span>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    aria-label={c}
                    className={`grid h-9 w-9 place-items-center rounded-full transition ${
                      color === c ? "ring-2 ring-slate-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-slate-900" : ""
                    }`}
                    style={{ background: c }}
                  >
                    {color === c && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
            {msg && (
              <p className={`rounded-xl px-4 py-3 text-xs font-bold ${msg.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                {msg.text}
              </p>
            )}
            <button
              onClick={saveProfile}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-black text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save changes ✨"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
            <Lock className="h-4 w-4 text-orange-500" /> Change password
          </h2>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">Current password</span>
              <input
                type={showPw ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:focus:border-white"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">New password</span>
              <span className="flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 focus-within:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:focus-within:border-white">
                <input
                  type={showPw ? "text" : "password"}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="Min 6 characters"
                  maxLength={100}
                  className="w-full bg-transparent py-2.5 text-sm font-semibold focus:outline-none"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="text-slate-400">
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
                            : "bg-slate-200 dark:bg-white/10"
                        }`}
                      />
                    ))}
                  </span>
                  <span className="mt-1 block text-[11px] font-bold text-slate-500">
                    {newPwStrength.emoji} {newPwStrength.label}
                  </span>
                </span>
              )}
            </label>
            {pwMsg && (
              <p className={`rounded-xl px-4 py-3 text-xs font-bold ${pwMsg.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                {pwMsg.text}
              </p>
            )}
            <button
              onClick={changePassword}
              disabled={pwSaving || !currentPw || !newPw}
              className="w-full rounded-xl bg-orange-500 py-3 text-sm font-black text-white transition hover:bg-orange-600 disabled:opacity-40"
            >
              {pwSaving ? "Updating…" : "Update password 🔒"}
            </button>
          </div>
        </div>
      </div>
    </OwnerGuard>
  );
}
