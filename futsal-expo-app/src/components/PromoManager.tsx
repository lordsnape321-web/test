import {
  CalendarClock,
  Dice5,
  Eye,
  EyeOff,
  IndianRupee,
  Pause,
  Pencil,
  Percent,
  Play,
  Plus,
  Sparkles,
  Ticket,
  Trash2,
  Users,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import * as Clipboard from "expo-clipboard";
import { apiFetch } from "@/lib/api";
import { formatNPR, todayISO } from "@/lib/futsal";
import { normalizePromoCode, promoDiscountFor, suggestPromoCode } from "@/lib/promos";
import {
  firstError,
  validateDiscountValue,
  validateMaxDiscount,
  validateMinBookingAmount,
  validatePromoCode,
  validatePromoTitle,
  validatePromoWindow,
  validateUsageLimit,
} from "@/lib/validation";
import { colors, fontSize, radius, space } from "@/theme";
import { DateField } from "@/components/DateTimeFields";

type Promo = {
  id: number;
  venueId: number;
  code: string;
  title: string;
  discountType: string;
  discountValue: number;
  maxDiscount: number;
  minBookingAmount: number;
  startsAt: string | null;
  expiresAt: string;
  usageLimit: number;
  perUserLimit: number;
  isPublic: boolean;
  isActive: boolean;
  summary: string;
  expiryLabel: string;
  expiresOn: string;
  startsOn: string;
  state: "live" | "upcoming" | "expired" | "paused";
  stateLabel: string;
  stateEmoji: string;
  live: boolean;
  usedCount: number;
  remaining: number | null;
  discountGiven: number;
};

/** One-tap starters — owners can adjust every field afterwards. */
const PRESETS: Array<{
  name: string;
  emoji: string;
  hint: string;
  fill: {
    code: string;
    title: string;
    discountType: "percent" | "flat";
    discountValue: number;
    maxDiscount: number;
    minBookingAmount: number;
    days: number;
    usageLimit: number;
    perUserLimit: number;
  };
}> = [
  {
    name: "Weekday boost",
    emoji: "📅",
    hint: "10% off, 14 days",
    fill: {
      code: "WEEKDAY10",
      title: "Weekday boost",
      discountType: "percent",
      discountValue: 10,
      maxDiscount: 0,
      minBookingAmount: 0,
      days: 14,
      usageLimit: 0,
      perUserLimit: 1,
    },
  },
  {
    name: "Festival offer",
    emoji: "🎉",
    hint: "20% off, capped at Rs. 500",
    fill: {
      code: "FESTIVE20",
      title: "Festival offer",
      discountType: "percent",
      discountValue: 20,
      maxDiscount: 500,
      minBookingAmount: 2000,
      days: 30,
      usageLimit: 50,
      perUserLimit: 1,
    },
  },
  {
    name: "Flat rupees off",
    emoji: "💸",
    hint: "Rs. 300 off, 7 days",
    fill: {
      code: "SAVE300",
      title: "Rs. 300 off",
      discountType: "flat",
      discountValue: 300,
      maxDiscount: 0,
      minBookingAmount: 1500,
      days: 7,
      usageLimit: 25,
      perUserLimit: 1,
    },
  },
];

function stateStyle(state: Promo["state"]): { bg: string; fg: string } {
  switch (state) {
    case "live":
      return { bg: "rgba(16,185,129,0.15)", fg: "#047857" };
    case "upcoming":
      return { bg: "rgba(14,165,233,0.15)", fg: "#0369A1" };
    case "expired":
      return { bg: "rgba(255,255,255,0.10)", fg: "#64748B" };
    case "paused":
      return { bg: "rgba(245,158,11,0.15)", fg: "#B45309" };
  }
}

export function PromoManager({
  venue,
  ownerId,
  samplePrice = 1500,
}: {
  venue: { id: number; name: string } | null;
  ownerId: number;
  samplePrice?: number;
}) {
  const { colors: c, isDark } = useTheme();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promo | null>(null);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");
  const [discountValue, setDiscountValue] = useState("10");
  const [maxDiscount, setMaxDiscount] = useState("0");
  const [minBookingAmount, setMinBookingAmount] = useState("0");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => todayISO(30));
  const [usageLimit, setUsageLimit] = useState("0");
  const [perUserLimit, setPerUserLimit] = useState("1");
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const venueId = venue?.id ?? 0;

  const load = useCallback(async () => {
    if (!venueId) return;
    try {
      const res = await apiFetch(`/api/promos?ownerId=${ownerId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load promo codes");
      setPromos(((data.promos ?? []) as Promo[]).filter((p) => p.venueId === venueId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load promo codes 🙏");
    } finally {
      setLoading(false);
    }
  }, [venueId, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const live = promos.filter((p) => p.live);
    return {
      live: live.length,
      used: promos.reduce((s, p) => s + p.usedCount, 0),
      given: promos.reduce((s, p) => s + p.discountGiven, 0),
      expiringSoon: live.filter((p) => p.expiresAt <= todayISO(7)).length,
    };
  }, [promos]);

  function resetForm() {
    setEditing(null);
    setCode("");
    setTitle("");
    setDiscountType("percent");
    setDiscountValue("10");
    setMaxDiscount("0");
    setMinBookingAmount("0");
    setStartsAt("");
    setExpiresAt(todayISO(30));
    setUsageLimit("0");
    setPerUserLimit("1");
    setIsPublic(true);
    setFormError("");
  }

  function openCreate(preset?: (typeof PRESETS)[number]) {
    resetForm();
    if (preset) {
      const f = preset.fill;
      setCode(f.code);
      setTitle(f.title);
      setDiscountType(f.discountType);
      setDiscountValue(String(f.discountValue));
      setMaxDiscount(String(f.maxDiscount));
      setMinBookingAmount(String(f.minBookingAmount));
      setExpiresAt(todayISO(f.days));
      setUsageLimit(String(f.usageLimit));
      setPerUserLimit(String(f.perUserLimit));
    }
    setShowForm(true);
  }

  function openEdit(p: Promo) {
    setEditing(p);
    setCode(p.code);
    setTitle(p.title);
    setDiscountType(p.discountType === "flat" ? "flat" : "percent");
    setDiscountValue(String(p.discountValue));
    setMaxDiscount(String(p.maxDiscount));
    setMinBookingAmount(String(p.minBookingAmount));
    setStartsAt(p.startsAt ?? "");
    // An already-expired code can only be saved with a fresh expiry date.
    setExpiresAt(p.expiresAt < todayISO() ? todayISO(30) : p.expiresAt);
    setUsageLimit(String(p.usageLimit));
    setPerUserLimit(String(p.perUserLimit));
    setIsPublic(p.isPublic);
    setFormError("");
    setShowForm(true);
  }

  /** What a player would pay on a sample bill — shown live while typing. */
  const preview = useMemo(() => {
    const bill = Math.max(0, Math.round(Number(samplePrice) || 0) * 2);
    if (bill <= 0) return null;
    const value = Number(discountValue) || 0;
    const d = promoDiscountFor(
      {
        code,
        discountType,
        discountValue: value,
        maxDiscount: discountType === "percent" ? Number(maxDiscount) || 0 : 0,
        minBookingAmount: Number(minBookingAmount) || 0,
        expiresAt,
      },
      bill,
    );
    return {
      bill,
      discount: d.amount,
      payable: d.payable,
      belowMin: (Number(minBookingAmount) || 0) > bill,
    };
  }, [samplePrice, discountType, discountValue, maxDiscount, minBookingAmount, expiresAt, code]);

  async function save() {
    if (!venue) return;
    const cleanCode = normalizePromoCode(code);
    const err = firstError(
      validatePromoCode(cleanCode),
      title.trim() ? validatePromoTitle(title) : null,
      validateDiscountValue(Number(discountValue), discountType),
      discountType === "percent" ? validateMaxDiscount(Number(maxDiscount)) : null,
      validateMinBookingAmount(Number(minBookingAmount)),
      validateUsageLimit(Number(usageLimit), "Total redemption limit"),
      validateUsageLimit(Number(perUserLimit), "Per-player limit"),
      validatePromoWindow(startsAt, expiresAt),
    );
    if (err) {
      setFormError(err);
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        ownerId,
        code: cleanCode,
        title: title.trim(),
        discountType,
        discountValue: Number(discountValue),
        maxDiscount: discountType === "percent" ? Number(maxDiscount) : 0,
        minBookingAmount: Number(minBookingAmount),
        startsAt: startsAt || "",
        expiresAt,
        usageLimit: Number(usageLimit),
        perUserLimit: Number(perUserLimit),
        isPublic,
      };
      const res = await apiFetch(editing ? `/api/promos/${editing.id}` : "/api/promos", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? payload : { venueId: venue.id, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save the promo code");
      setShowForm(false);
      resetForm();
      setNotice(
        editing
          ? `${cleanCode} updated ✨`
          : `${cleanCode} is live 🎉 Players can use it until ${new Date(`${expiresAt}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`,
      );
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save the promo code 🙏");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Promo) {
    setBusy(p.id);
    setError("");
    try {
      const res = await apiFetch(`/api/promos/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, isActive: !p.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update");
      setNotice(p.isActive ? `${p.code} paused ⏸️` : `${p.code} is live again 🟢`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update 🙏");
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Promo) {
    // confirm() has no RN equivalent — a second explicit tap would be easy to
    // hit by accident, so deletion requires typing the code is overkill for a
    // promo; use a simple Alert from RN.
    const { Alert } = await import("react-native");
    Alert.alert(
      `Delete ${p.code}?`,
      "Players won't be able to use it any more.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(p.id);
              setError("");
              try {
                const res = await apiFetch(`/api/promos/${p.id}?ownerId=${ownerId}`, {
                  method: "DELETE",
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  // Already-redeemed codes are paused instead of deleted.
                  setNotice(data.error || "Couldn't delete 🙏");
                } else {
                  setNotice(`${p.code} deleted 🗑️`);
                }
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't delete 🙏");
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  }

  async function copyCode(p: Promo) {
    try {
      await Clipboard.setStringAsync(p.code);
      setCopied(p.code);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }

  const inputCls = [styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }];
  const labelCls = [styles.label, { color: c.textFaint }];

  if (!venue) return null;

  const statsChips = [
    { label: "Live codes", value: String(stats.live), emoji: "🟢" },
    { label: "Redeemed", value: String(stats.used), emoji: "🎟️" },
    { label: "Discount given", value: formatNPR(stats.given), emoji: "💸" },
    { label: "Ending ≤7 days", value: String(stats.expiringSoon), emoji: "⏳" },
  ];

  return (
    <View style={{ gap: space[3] }}>
      <View style={styles.topRow}>
        <View style={styles.statChips}>
          {statsChips.map((s) => (
            <View
              key={s.label}
              style={[styles.statChip, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <Text style={[styles.statChipText, { color: c.textMuted }]}>
                {s.emoji} {s.label}: <Text style={{ color: c.text }}>{s.value}</Text>
              </Text>
            </View>
          ))}
        </View>
        <Pressable
          onPress={() => openCreate()}
          style={styles.newBtn}
          accessibilityRole="button"
        >
          <Plus size={14} color="#FFFFFF" strokeWidth={3} />
          <Text style={styles.newBtnText}>New promo code</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.alertError}>{error}</Text> : null}
      {notice ? <Text style={styles.alertOk}>{notice}</Text> : null}

      {loading ? (
        <View style={[styles.loadingBlock, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9" }]} />
      ) : promos.length === 0 ? (
        <View style={[styles.emptyCard, { borderColor: c.border }]}>
          <Ticket size={36} color={c.textFaint} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>No promo codes yet 🎟️</Text>
          <Text style={[styles.emptyBody, { color: c.textMuted }]}>
            Create a code with an expiry date — players type it at checkout and pay less. Empty
            weekday slots? A code fills them.
          </Text>
          <View style={styles.presetWrap}>
            {PRESETS.map((p) => (
              <Pressable
                key={p.name}
                onPress={() => openCreate(p)}
                style={[styles.presetBtn, { borderColor: c.border, backgroundColor: c.surface }]}
              >
                <Text style={[styles.presetName, { color: c.text }]}>
                  {p.emoji} {p.name}
                </Text>
                <Text style={[styles.presetHint, { color: c.textMuted }]}>{p.hint}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ gap: space[2.5] }}>
          {promos.map((p) => {
            const st = stateStyle(p.state);
            return (
              <View
                key={p.id}
                style={[
                  styles.promoCard,
                  {
                    backgroundColor: c.surface,
                    borderColor: c.border,
                    opacity: p.live ? 1 : 0.75,
                  },
                ]}
              >
                <View style={styles.promoHead}>
                  <View style={styles.promoIcon}>
                    {p.discountType === "flat" ? (
                      <IndianRupee size={20} color="#FFFFFF" strokeWidth={2.5} />
                    ) : (
                      <Percent size={20} color="#FFFFFF" strokeWidth={2.5} />
                    )}
                  </View>
                  <View style={styles.grow}>
                    <View style={styles.codeRow}>
                      <Pressable
                        onPress={() => void copyCode(p)}
                        accessibilityLabel="Copy code"
                        style={styles.codeBtn}
                      >
                        <Text style={styles.codeText}>{p.code}</Text>
                      </Pressable>
                      {copied === p.code ? (
                        <Text style={styles.copied}>Copied ✓</Text>
                      ) : null}
                      <View style={[styles.stateChip, { backgroundColor: st.bg }]}>
                        <Text style={[styles.stateText, { color: st.fg }]}>
                          {p.stateEmoji} {p.stateLabel}
                        </Text>
                      </View>
                      {!p.isPublic ? (
                        <View style={[styles.hiddenChip, { backgroundColor: c.inset }]}>
                          <EyeOff size={12} color={c.textMuted} />
                          <Text style={[styles.hiddenText, { color: c.textMuted }]}>Hidden</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.summary, { color: c.text }]}>
                      {p.summary}
                      {p.title ? <Text style={{ fontWeight: "600", color: c.textMuted }}> • {p.title}</Text> : null}
                    </Text>
                    <Text style={[styles.meta, { color: c.textMuted }]}>
                      <CalendarClock size={12} color={c.textMuted} />{" "}
                      {p.startsOn ? `${p.startsOn} → ` : ""}
                      {p.expiresOn} • {p.expiryLabel} · 🎟 {p.usedCount}
                      {p.usageLimit > 0 ? `/${p.usageLimit}` : ""} used
                      {p.remaining !== null ? ` • ${p.remaining} left` : " • unlimited"} · 👥{" "}
                      {p.perUserLimit > 0 ? `${p.perUserLimit} per player` : "unlimited per player"}
                      {p.minBookingAmount > 0 ? ` · Min booking ${formatNPR(p.minBookingAmount)}` : ""}
                      {p.discountGiven > 0 ? ` · Given away ${formatNPR(p.discountGiven)}` : ""}
                    </Text>
                  </View>
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => void toggleActive(p)}
                      disabled={busy === p.id}
                      accessibilityLabel={p.isActive ? "Pause this code" : "Make it live again"}
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: p.isActive
                            ? "rgba(245,158,11,0.15)"
                            : "rgba(16,185,129,0.15)",
                          opacity: busy === p.id ? 0.4 : 1,
                        },
                      ]}
                    >
                      {p.isActive ? (
                        <Pause size={16} color={p.isActive ? "#B45309" : "#047857"} />
                      ) : (
                        <Play size={16} color="#047857" />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => openEdit(p)}
                      disabled={busy === p.id}
                      accessibilityLabel="Edit code, discount or expiry"
                      style={[styles.actionBtn, { backgroundColor: c.inset, opacity: busy === p.id ? 0.4 : 1 }]}
                    >
                      <Pencil size={16} color={c.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => void remove(p)}
                      disabled={busy === p.id}
                      accessibilityLabel="Delete code"
                      style={[styles.actionBtn, { backgroundColor: "rgba(239,68,68,0.15)", opacity: busy === p.id ? 0.4 : 1 }]}
                    >
                      <Trash2 size={16} color="#DC2626" />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Create / edit */}
      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={[styles.flex, { backgroundColor: isDark ? "#0F172A" : "#F8FAFC" }]}>
          <ScrollView contentContainerStyle={styles.formScroll}>
            <Text style={[styles.formTitle, { color: c.text }]}>
              <Sparkles size={18} color={colors.amber400} />{" "}
              {editing ? `Edit ${editing.code} ✏️` : "New promo code 🎟️"}
            </Text>
            <Text style={[styles.formSub, { color: c.textMuted }]}>
              at {venue.name} — players type the code at checkout.
            </Text>

            {!editing ? (
              <View style={styles.presetWrap}>
                {PRESETS.map((p) => (
                  <Pressable
                    key={p.name}
                    onPress={() => {
                      const f = p.fill;
                      setCode(f.code);
                      setTitle(f.title);
                      setDiscountType(f.discountType);
                      setDiscountValue(String(f.discountValue));
                      setMaxDiscount(String(f.maxDiscount));
                      setMinBookingAmount(String(f.minBookingAmount));
                      setExpiresAt(todayISO(f.days));
                      setUsageLimit(String(f.usageLimit));
                      setPerUserLimit(String(f.perUserLimit));
                      setFormError("");
                    }}
                    style={[styles.presetBtn, { borderColor: c.border }]}
                  >
                    <Text style={[styles.presetName, { color: c.text }]}>
                      {p.emoji} {p.name}
                    </Text>
                    <Text style={[styles.presetHint, { color: c.textMuted }]}>{p.hint}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={labelCls}>Promo code *</Text>
              <View style={styles.codeInputRow}>
                <TextInput
                  value={code}
                  onChangeText={(t) => setCode(normalizePromoCode(t))}
                  placeholder="e.g. SAVE10"
                  placeholderTextColor={c.textFaint}
                  maxLength={24}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[inputCls, styles.codeInput, { fontFamily: "monospace" }]}
                />
                <Pressable
                  onPress={() => setCode(suggestPromoCode(title || venue.name))}
                  accessibilityLabel="Suggest a code"
                  style={[styles.suggestBtn, { borderColor: c.border }]}
                >
                  <Dice5 size={16} color={c.textMuted} />
                </Pressable>
              </View>
              <Text style={[styles.help, { color: c.textFaint }]}>
                Letters, numbers and dashes — saved uppercase, {code.trim().length}/24.
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={labelCls}>Offer name (optional, shown to you + players)</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Weekend early-bird"
                placeholderTextColor={c.textFaint}
                maxLength={60}
                style={inputCls}
              />
            </View>

            <View style={styles.grid2}>
              <View style={styles.field}>
                <Text style={labelCls}>Discount type</Text>
                <View style={styles.segment}>
                  {(["percent", "flat"] as const).map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setDiscountType(t)}
                      style={[
                        styles.segmentBtn,
                        discountType === t && styles.segmentOn,
                        { borderColor: c.border },
                      ]}
                    >
                      <Text
                        style={{
                          color: discountType === t ? "#FFFFFF" : c.textMuted,
                          fontSize: fontSize.xs,
                          fontWeight: "900",
                        }}
                      >
                        {t === "percent" ? "% off" : "Rs. off"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.field}>
                <Text style={labelCls}>
                  {discountType === "percent" ? "Percent off *" : "Rupees off *"}
                </Text>
                <TextInput
                  value={discountValue}
                  onChangeText={setDiscountValue}
                  keyboardType="numeric"
                  style={inputCls}
                />
              </View>
              {discountType === "percent" ? (
                <View style={styles.field}>
                  <Text style={labelCls}>Max discount cap (0 = no cap)</Text>
                  <TextInput
                    value={maxDiscount}
                    onChangeText={setMaxDiscount}
                    keyboardType="numeric"
                    style={inputCls}
                  />
                </View>
              ) : null}
              <View style={styles.field}>
                <Text style={labelCls}>Minimum booking (0 = any)</Text>
                <TextInput
                  value={minBookingAmount}
                  onChangeText={setMinBookingAmount}
                  keyboardType="numeric"
                  style={inputCls}
                />
              </View>
              <View style={styles.field}>
                <DateField label="Starts (blank = now)" value={startsAt} onChange={setStartsAt} allowClear />
              </View>
              <View style={styles.field}>
                <DateField label="Expires on *" value={expiresAt} onChange={setExpiresAt} />
              </View>
              <View style={styles.field}>
                <Text style={labelCls}>Total redemptions (0 = unlimited)</Text>
                <TextInput
                  value={usageLimit}
                  onChangeText={setUsageLimit}
                  keyboardType="numeric"
                  style={inputCls}
                />
              </View>
              <View style={styles.field}>
                <Text style={labelCls}>Per player (0 = unlimited)</Text>
                <TextInput
                  value={perUserLimit}
                  onChangeText={setPerUserLimit}
                  keyboardType="numeric"
                  style={inputCls}
                />
              </View>
            </View>

            <Pressable
              onPress={() => setIsPublic((v) => !v)}
              style={[
                styles.toggleRow,
                {
                  borderColor: isPublic ? "rgba(16,185,129,0.4)" : c.border,
                  backgroundColor: isPublic ? "rgba(16,185,129,0.10)" : c.inset,
                },
              ]}
            >
              {isPublic ? (
                <Eye size={16} color={colors.emerald600} />
              ) : (
                <EyeOff size={16} color={c.textMuted} />
              )}
              <View style={styles.grow}>
                <Text style={[styles.toggleTitle, { color: c.text }]}>
                  {isPublic ? "Advertise on the venue page" : "Hidden — code still works"}
                </Text>
                <Text style={[styles.toggleSub, { color: c.textMuted }]}>
                  {isPublic
                    ? "Players see it while booking and can tap to apply."
                    : "Only people you share it with can use it."}
                </Text>
              </View>
              <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ true: "#10B981" }} />
            </Pressable>

            {preview ? (
              <Text style={[styles.preview, { backgroundColor: c.inset, color: c.textMuted }]}>
                {preview.belowMin
                  ? `⚠️ A typical 2-hr booking here (${formatNPR(preview.bill)}) is under your ${formatNPR(Number(minBookingAmount) || 0)} minimum — players would be turned away.`
                  : `🧮 Example: ${formatNPR(preview.bill)} booking → ${formatNPR(preview.discount)} off, player pays ${formatNPR(preview.payable)}.`}
              </Text>
            ) : null}

            {formError ? <Text style={styles.alertError}>{formError}</Text> : null}

            <View style={styles.formActions}>
              <Pressable
                onPress={() => {
                  setShowForm(false);
                  setFormError("");
                }}
                style={[styles.cancelBtn, { borderColor: c.border }]}
              >
                <Text style={[styles.cancelText, { color: c.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void save()}
                disabled={saving}
                style={[styles.saveBtn, { opacity: saving ? 0.45 : 1, backgroundColor: c.text }]}
              >
                <Text style={[styles.saveText, { color: c.surface }]}>
                  {saving ? "Saving…" : editing ? "Save changes ✨" : "Create code 🎉"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  topRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  statChips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  statChip: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  statChipText: { fontSize: fontSize.xs, fontWeight: "900" },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1.5],
    backgroundColor: "#0F172A",
    borderRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingVertical: space[2.5],
  },
  newBtnText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  alertError: {
    borderRadius: radius.xl,
    backgroundColor: "rgba(239,68,68,0.10)",
    color: "#DC2626",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.xs,
    fontWeight: "700",
    overflow: "hidden",
  },
  alertOk: {
    borderRadius: radius.xl,
    backgroundColor: "rgba(16,185,129,0.10)",
    color: "#047857",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.xs,
    fontWeight: "700",
    overflow: "hidden",
  },
  loadingBlock: { height: 128, borderRadius: radius.xl },
  emptyCard: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[8],
    alignItems: "center",
  },
  emptyTitle: { marginTop: space[3], fontSize: fontSize.base, fontWeight: "800" },
  emptyBody: {
    marginTop: space[1],
    textAlign: "center",
    fontSize: fontSize.sm,
    maxWidth: 360,
    lineHeight: 18,
  },
  presetWrap: {
    marginTop: space[4],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    justifyContent: "center",
  },
  presetBtn: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
  },
  presetName: { fontSize: fontSize.xs, fontWeight: "900" },
  presetHint: { fontSize: fontSize.xs, fontWeight: "700" },
  promoCard: { borderRadius: radius.xl, borderWidth: 1, padding: space[3.5] },
  promoHead: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  promoIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.xl,
    backgroundColor: "#F59E0B",
    alignItems: "center",
    justifyContent: "center",
  },
  codeRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  codeBtn: {
    backgroundColor: "#0F172A",
    borderRadius: radius.lg,
    paddingHorizontal: space[2.5],
    paddingVertical: space[1],
  },
  codeText: {
    color: "#FFFFFF",
    fontFamily: "monospace",
    fontSize: fontSize.sm,
    fontWeight: "900",
    letterSpacing: 1,
  },
  copied: { color: "#059669", fontSize: fontSize.xs, fontWeight: "900" },
  stateChip: { borderRadius: radius.full, paddingHorizontal: space[2.5], paddingVertical: 3 },
  stateText: { fontSize: fontSize["2xs"], fontWeight: "900", textTransform: "uppercase" },
  hiddenChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: space[2],
    paddingVertical: 3,
  },
  hiddenText: { fontSize: fontSize["2xs"], fontWeight: "900" },
  summary: { marginTop: space[1.5], fontSize: 13, fontWeight: "800" },
  meta: { marginTop: space[1], fontSize: fontSize.xs, lineHeight: 17 },
  actions: { flexDirection: "row", gap: space[1.5] },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  formScroll: { padding: space[4], paddingBottom: space[12], gap: space[3] },
  formTitle: { fontSize: fontSize.lg, fontWeight: "900", flexDirection: "row", gap: 6 },
  formSub: { fontSize: fontSize.xs, marginTop: -space[2] },
  field: { marginBottom: space[1] },
  label: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: space[1.5],
  },
  input: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    fontSize: fontSize.sm,
    fontWeight: "600",
    minHeight: 44,
  },
  codeInputRow: { flexDirection: "row", gap: space[2] },
  codeInput: { flex: 1, textTransform: "uppercase" },
  suggestBtn: {
    width: 48,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  help: { fontSize: fontSize.xs, marginTop: space[1] },
  grid2: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  grid2child: { flexGrow: 1, minWidth: "45%" },
  segment: { flexDirection: "row", gap: space[1.5] },
  segmentBtn: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: space[2.5],
    alignItems: "center",
  },
  segmentOn: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2.5],
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[3],
  },
  toggleTitle: { fontSize: fontSize.xs, fontWeight: "900" },
  toggleSub: { fontSize: fontSize.xs, marginTop: 2 },
  preview: {
    borderRadius: radius.xl,
    paddingHorizontal: space[3.5],
    paddingVertical: space[3],
    fontSize: fontSize.xs,
    lineHeight: 17,
    overflow: "hidden",
  },
  formActions: { flexDirection: "row", gap: space[2], marginTop: space[2] },
  cancelBtn: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: space[3],
    alignItems: "center",
  },
  cancelText: { fontSize: fontSize.sm, fontWeight: "900" },
  saveBtn: {
    flex: 1,
    borderRadius: radius.xl,
    paddingVertical: space[3],
    alignItems: "center",
  },
  saveText: { fontSize: fontSize.sm, fontWeight: "900" },
});
