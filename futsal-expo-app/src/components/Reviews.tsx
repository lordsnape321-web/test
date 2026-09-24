import { MessageCircleHeart, RotateCcw, Star } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { apiFetch, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import { validateMessage } from "@/lib/validation";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Reviews — a 1:1 port of the web app's components/Reviews.tsx.
 *
 * Same three exports: Stars (read-only row), StarInput (tap 1–5), and
 * ReviewsSection (list + one-review-per-venue form). Hover states on the web
 * become plain presses here; the select for "which game?" becomes a chip list
 * because RN has no cross-platform select.
 */

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

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const empty = useTheme().isDark ? "rgba(255,255,255,0.10)" : "#E7E5E4";
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          color={i <= Math.round(value) ? colors.amber400 : empty}
          fill={i <= Math.round(value) ? colors.amber400 : empty}
        />
      ))}
    </View>
  );
}

export function StarInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const empty = useTheme().isDark ? "rgba(255,255,255,0.10)" : "#E7E5E4";
  return (
    <View style={styles.starInputRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable
          key={i}
          onPress={() => onChange(i)}
          accessibilityRole="button"
          accessibilityLabel={`${i} stars`}
          hitSlop={4}
          style={({ pressed }) => [{ transform: [{ scale: pressed ? 1.15 : 1 }] }]}
        >
          <Star
            size={32}
            color={i <= value ? colors.amber400 : empty}
            fill={i <= value ? colors.amber400 : empty}
          />
        </Pressable>
      ))}
    </View>
  );
}

const RATING_WORDS = ["", "Poor 😞", "Okay 😐", "Good 🙂", "Great 😄", "Amazing! 🤩"];

export function ReviewsSection({
  venueId,
  venueName,
  eligibleBookings = [],
  onChanged,
}: {
  venueId: number;
  venueName: string;
  eligibleBookings?: Array<{ id: number; label: string }>;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const { colors: c, isDark } = useTheme();
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
    } catch {
      /* keep the last list */
    }
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
    setRating(mine?.rating ?? 5);
    setMessage(mine?.message ?? "");
    setBookingId(
      mine?.bookingId
        ? String(mine.bookingId)
        : eligibleBookings.length === 1
          ? String(eligibleBookings[0].id)
          : "",
    );
    setError("");
    setShowForm(true);
  }

  async function submit() {
    if (!user) return;
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

  const cardBg = isDark ? "rgba(255,255,255,0.04)" : c.surface;

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: c.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitle}>
          <MessageCircleHeart size={16} color={colors.orange500} />
          <Text style={[styles.headerText, { color: colors.orange500 }]}>What players say 💬</Text>
        </View>
        {reviews.length > 0 ? (
          <View style={[styles.avgPill, { backgroundColor: isDark ? "rgba(245,158,11,0.10)" : "#FFFBEB" }]}>
            <Stars value={avg} size={12} />
            <Text style={[styles.avgText, { color: c.text }]}>
              {avg} • {reviews.length} review{reviews.length !== 1 ? "s" : ""}
            </Text>
          </View>
        ) : null}
      </View>

      {canReview && !showForm ? (
        <Pressable
          onPress={openForm}
          style={[styles.cta, { borderColor: isDark ? "rgba(249,115,22,0.4)" : "#FDBA74", backgroundColor: isDark ? "rgba(249,115,22,0.10)" : "#FFF7ED" }]}
          accessibilityRole="button"
        >
          <Text style={[styles.ctaText, { color: isDark ? colors.orange300 : "#C2410C" }]}>
            {mine ? `Update your review of ${venueName} ⭐` : `Played at ${venueName}? Share some love ⭐`}
          </Text>
        </Pressable>
      ) : null}
      {canReview && mine && !showForm ? (
        <Text style={[styles.lockNote, { color: c.textFaint }]}>
          One review per venue — posting again updates yours, it won&apos;t add a second 🔒
        </Text>
      ) : null}

      {showForm ? (
        <View style={[styles.form, { borderColor: isDark ? "rgba(249,115,22,0.25)" : "#FED7AA", backgroundColor: isDark ? "rgba(249,115,22,0.05)" : "rgba(255,247,237,0.6)" }]}>
          {mine ? (
            <View style={styles.updatingRow}>
              <RotateCcw size={14} color={colors.orange500} />
              <Text style={[styles.updatingText, { color: isDark ? colors.orange300 : "#C2410C" }]}>
                Updating your review — it replaces the old one, no second review 🔒
              </Text>
            </View>
          ) : null}

          {eligibleBookings.length > 1 ? (
            <View style={{ marginBottom: space[3] }}>
              <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Which game?</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Pressable
                  onPress={() => setBookingId("")}
                  style={[
                    styles.gameChip,
                    {
                      backgroundColor: bookingId === "" ? colors.emerald600 : c.surface,
                      borderColor: bookingId === "" ? colors.emerald600 : c.border,
                    },
                  ]}
                >
                  <Text style={{ color: bookingId === "" ? "#FFFFFF" : c.text, fontSize: fontSize.sm, fontWeight: "700" }}>
                    General visit
                  </Text>
                </Pressable>
                {eligibleBookings.map((b) => {
                  const on = bookingId === String(b.id);
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() => setBookingId(String(b.id))}
                      style={[
                        styles.gameChip,
                        { backgroundColor: on ? colors.emerald600 : c.surface, borderColor: on ? colors.emerald600 : c.border },
                      ]}
                    >
                      <Text style={{ color: on ? "#FFFFFF" : c.text, fontSize: fontSize.sm, fontWeight: "700" }}>
                        {b.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.starLine}>
            <StarInput value={rating} onChange={setRating} />
            <Text style={[styles.ratingWord, { color: c.text }]}>{RATING_WORDS[rating]}</Text>
          </View>

          <TextInput
            value={message}
            onChangeText={(t) => {
              setMessage(t);
              setError("");
            }}
            multiline
            maxLength={1000}
            placeholder={`How was ${venueName}? Turf, vibe, staff… tell future players! ⚽`}
            placeholderTextColor={c.textFaint}
            style={[
              styles.textarea,
              { backgroundColor: c.surface, borderColor: c.border, color: c.text },
            ]}
          />
          <Text style={[styles.counter, { color: c.textFaint }]}>
            {message.trim().length}/1000 • min 3 characters 💬
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.formActions}>
            <Pressable
              onPress={() => {
                setShowForm(false);
                setError("");
              }}
              style={[styles.laterBtn, { borderColor: c.border }]}
              accessibilityRole="button"
            >
              <Text style={[styles.laterText, { color: c.textMuted }]}>Later</Text>
            </Pressable>
            <Pressable
              onPress={() => void submit()}
              disabled={saving}
              style={[styles.submitBtn, { opacity: saving ? 0.55 : 1 }]}
              accessibilityRole="button"
            >
              {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
              <Text style={styles.submitText}>
                {saving ? "Saving…" : mine ? "Update review 💛" : "Post review 💛"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={{ marginTop: space[3], gap: space[2.5] }}>
          {[0, 1].map((i) => (
            <View key={i} style={[styles.skeleton, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAF9" }]} />
          ))}
        </View>
      ) : reviews.length === 0 ? (
        <Text style={[styles.empty, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAF9", color: c.textFaint }]}>
          No reviews yet — be the first to play here and tell the story! 🌟
        </Text>
      ) : (
        <View style={{ marginTop: space[3], gap: space[2.5] }}>
          {reviews.map((r) => (
            <View
              key={r.id}
              style={[styles.reviewRow, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(250,250,249,0.6)", borderColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAF9" }]}
            >
              <View style={styles.reviewHead}>
                <Avatar user={{ name: r.userName, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl }} size={36} />
                <View style={styles.grow}>
                  <Text style={[styles.reviewer, { color: c.text }]} numberOfLines={1}>
                    {r.userName}
                    {r.userId === user?.id ? (
                      <Text style={styles.youTag}>  YOU</Text>
                    ) : null}
                  </Text>
                  <Text style={[styles.reviewMeta, { color: c.textFaint }]}>
                    {r.userLevel ? `${r.userLevel} • ` : ""}
                    {timeAgo(r.createdAt)}
                    {r.updatedAt ? ` • updated ${timeAgo(r.updatedAt)}` : ""}
                  </Text>
                </View>
                <Stars value={r.rating} size={14} />
                {r.userId === user?.id ? (
                  <Text style={[styles.lockEmoji, { color: c.textFaint }]}>🔒</Text>
                ) : null}
              </View>
              <Text style={[styles.reviewBody, { color: isDark ? "#CBD5E1" : "#57534E" }]}>
                “{r.message}”
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
    marginTop: space[4],
  },
  headerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: space[2] },
  headerText: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  avgPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    paddingVertical: space[1.5],
  },
  avgText: { fontSize: fontSize.xs, fontWeight: "900" },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  starInputRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  cta: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 2,
    borderStyle: "dashed",
    paddingVertical: space[3],
    alignItems: "center",
  },
  ctaText: { fontSize: fontSize.sm, fontWeight: "900", textAlign: "center" },
  lockNote: {
    marginTop: space[1.5],
    textAlign: "center",
    fontSize: fontSize.xs,
    fontWeight: "700",
  },
  form: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    gap: space[3],
  },
  updatingRow: { flexDirection: "row", alignItems: "center", gap: space[1.5] },
  updatingText: { fontSize: fontSize.xs, fontWeight: "900", flex: 1 },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: space[1.5],
  },
  gameChip: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    marginRight: space[2],
  },
  starLine: { flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" },
  ratingWord: { fontSize: fontSize.sm, fontWeight: "900" },
  textarea: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space[3.5],
    fontSize: fontSize.sm,
    fontWeight: "600",
    minHeight: 88,
    textAlignVertical: "top",
  },
  counter: { fontSize: fontSize.xs, marginTop: -space[2] },
  error: { fontSize: fontSize.xs, fontWeight: "700", color: "#EF4444" },
  formActions: { flexDirection: "row", gap: space[2] },
  laterBtn: {
    flex: 1,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    paddingVertical: space[3],
    alignItems: "center",
  },
  laterText: { fontSize: fontSize.sm, fontWeight: "900" },
  submitBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    backgroundColor: colors.orange500,
    paddingVertical: space[3],
  },
  submitText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  skeleton: { height: 80, borderRadius: radius["2xl"] },
  empty: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: space[6],
    textAlign: "center",
    fontSize: fontSize.sm,
  },
  reviewRow: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[3.5],
  },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: space[2.5] },
  grow: { flex: 1, minWidth: 0 },
  reviewer: { fontSize: fontSize.sm, fontWeight: "800" },
  youTag: {
    fontSize: fontSize["2xs"],
    fontWeight: "900",
    color: colors.emerald700,
    backgroundColor: "rgba(16,185,129,0.15)",
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: "hidden",
  },
  reviewMeta: { fontSize: fontSize.xs },
  lockEmoji: { fontSize: fontSize.sm },
  reviewBody: { marginTop: space[2], fontSize: 13, lineHeight: 19 },
});
