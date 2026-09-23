"use client";

import { useEffect, useState } from "react";
import { Star, MessageCircleHeart, Loader2, RotateCcw } from "lucide-react";
import { useUser } from "./UserProvider";
import { Avatar } from "./Avatar";
import { timeAgo } from "./NotificationBell";
import { validateMessage } from "@/lib/validation";
import { apiFetch } from "@/lib/api";

export type Review = {
  id: number;
  venueId: number;
  userId: number;
  bookingId: number | null;
  rating: number;
  message: string;
  createdAt: string | null;
  updatedAt: string | null;
  userName: string;
  avatarColor: string;
  avatarUrl?: string;
  userLevel: string;
};

export function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${size} ${i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-stone-200 text-stone-200 dark:fill-white/10 dark:text-white/10"}`}
        />
      ))}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          aria-label={`${i} stars`}
          className="transition-transform hover:scale-125"
        >
          <Star
            className={`h-8 w-8 ${
              i <= (hover || value) ? "fill-amber-400 text-amber-400" : "fill-stone-200 text-stone-200 dark:fill-white/10 dark:text-white/10"
            }`}
          />
        </button>
      ))}
    </span>
  );
}

const RATING_WORDS = ["", "Poor 😞", "Okay 😐", "Good 🙂", "Great 😄", "Amazing! 🤩"];

export function ReviewsSection({
  venueId,
  venueName,
  eligibleBookings = [],
  compact = false,
  onChanged,
}: {
  venueId: number;
  venueName: string;
  eligibleBookings?: Array<{ id: number; label: string }>;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const { user } = useUser();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      const res = await apiFetch(`/api/reviews?venueId=${venueId}`);
      const data = await res.json();
      setReviews(data.reviews ?? []);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  const avg =
    reviews.length > 0
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : 0;

  const canReview = !!user && eligibleBookings.length > 0;
  // My one review here, if I've written one. Reviewing again updates this row —
  // a venue never shows two reviews from the same player.
  const mine = reviews.find((r) => r.userId === user?.id) ?? null;

  function openForm() {
    // Editing my review starts from what I already said, not from a blank box.
    setRating(mine?.rating ?? 5);
    setMessage(mine?.message ?? "");
    // With a single played game there's no picker to choose from, so attach the
    // review to that game rather than leaving it a general visit.
    setBookingId(
      mine?.bookingId
        ? String(mine.bookingId)
        : eligibleBookings.length === 1
          ? String(eligibleBookings[0].id)
          : ""
    );
    setError("");
    setShowForm(true);
  }

  async function submit() {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    const vErr = validateMessage(message.trim(), { min: 3, max: 1000, label: "Review" });
    if (vErr) {
      setError(vErr);
      return;
    }
    if (rating < 1 || rating > 5) {
      setError("Tap 1–5 stars ⭐");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          userId: user.id,
          bookingId: bookingId ? Number(bookingId) : null,
          rating,
          message: message.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessage("");
      setRating(5);
      setBookingId("");
      setShowForm(false);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={compact ? "" : "rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-orange-500 dark:text-orange-400">
          <MessageCircleHeart className="h-4 w-4" />
          What players say 💬
        </h2>
        {reviews.length > 0 && (
          <span className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 dark:bg-amber-500/10">
            <Stars value={avg} />
            <span className="text-xs font-black text-stone-800 dark:text-slate-100">
              {avg} • {reviews.length} review{reviews.length !== 1 ? "s" : ""}
            </span>
          </span>
        )}
      </div>

      {canReview && !showForm && (
        <button
          onClick={openForm}
          className="mt-3 w-full rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50 py-3 text-sm font-black text-orange-700 transition hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300"
        >
          {mine ? `Update your review of ${venueName} ⭐` : `Played at ${venueName}? Share some love ⭐`}
        </button>
      )}
      {canReview && mine && !showForm && (
        <p className="mt-1.5 text-center text-[11px] font-bold text-stone-400 dark:text-slate-500">
          One review per venue — posting again updates yours, it won&apos;t add a second 🔒
        </p>
      )}

      {showForm && (
        <div className="mt-3 space-y-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-500/25 dark:bg-orange-500/5">
          {mine && (
            <p className="flex items-center gap-1.5 text-xs font-black text-orange-700 dark:text-orange-300">
              <RotateCcw className="h-3.5 w-3.5" />
              Updating your review — it replaces the old one, no second review 🔒
            </p>
          )}
          {eligibleBookings.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-wider text-stone-400">Which game?</span>
              <select
                value={bookingId}
                onChange={(e) => setBookingId(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-white/10 dark:bg-slate-950 [&>option]:bg-white [&>option]:text-stone-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
              >
                <option value="">General visit</option>
                {eligibleBookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center gap-3">
            <StarInput value={rating} onChange={setRating} />
            <span className="text-sm font-black text-stone-700 dark:text-slate-200">
              {RATING_WORDS[rating]}
            </span>
          </div>
          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setError("");
            }}
            rows={3}
            maxLength={1000}
            placeholder={`How was ${venueName}? Turf, vibe, staff… tell future players! ⚽`}
            className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm font-semibold placeholder:text-stone-400 focus:border-orange-400 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:placeholder:text-slate-500"
          />
          <p className="text-[11px] text-stone-400">{message.trim().length}/1000 • min 3 characters 💬</p>
          {error && <p className="text-xs font-bold text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowForm(false);
                setError("");
              }}
              className="flex-1 rounded-2xl border border-stone-200 py-3 text-sm font-black text-stone-600 dark:border-white/10 dark:text-slate-300"
            >
              Later
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-orange-500 py-3 text-sm font-black text-white shadow transition hover:bg-orange-600 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : mine ? "Update review 💛" : "Post review 💛"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-3 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-100 dark:bg-white/5" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-400 dark:bg-white/5 dark:text-slate-500">
          No reviews yet — be the first to play here and tell the story! 🌟
        </p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {reviews.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border border-stone-100 bg-stone-50/60 p-3.5 dark:border-white/5 dark:bg-white/5"
            >
              <div className="flex items-center gap-2.5">
                <Avatar user={{ name: r.userName, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl }} className="h-9 w-9 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-stone-900 dark:text-slate-100">
                    {r.userName}
                    {r.userId === user?.id && (
                      <span className="ml-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                        YOU
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-stone-400">
                    {r.userLevel && `${r.userLevel} • `}{timeAgo(r.createdAt)}
                    {r.updatedAt && ` • updated ${timeAgo(r.updatedAt)}`}
                  </p>
                </div>
                <Stars value={r.rating} size="h-3.5 w-3.5" />
                {r.userId === user?.id && (
                  <span
                    title="Reviews are locked — you can update yours, not delete it"
                    className="grid h-7 w-7 place-items-center rounded-lg text-stone-300 dark:text-slate-600"
                  >
                    🔒
                  </span>
                )}
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-stone-600 dark:text-slate-300">
                “{r.message}”
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
