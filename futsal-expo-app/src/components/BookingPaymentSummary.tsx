import { ChevronDown, ChevronUp, Wallet } from "lucide-react-native";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { apiFetch } from "@/lib/api";
import { formatNPR } from "@/lib/futsal";
import { colors, fontSize, radius, space } from "@/theme";

type Line = {
  id: number;
  amount: number;
  method?: string;
  label?: string;
  note?: string;
  reference?: string;
  voidedAt: string | null;
};

type Summary = {
  totals: {
    courtPrice: number;
    extrasTotal: number;
    owed: number;
    paid: number;
    balance: number;
    surplus: number;
    byMethod: Record<string, number>;
    settled: boolean;
  };
  payments: Line[];
  extras: Line[];
};

/**
 * What the player has actually paid, and how 🧾
 *
 * The owner records a game's money in parts — some by eSewa, some by Khalti,
 * some in cash at the counter — and adds the water on afterwards. The player
 * should be able to see that same breakdown rather than just a "paid" badge, so
 * this reads the same ledger the owner's desk writes to.
 *
 * Fetched on demand: a bookings list can be long, and most cards never get
 * opened.
 */
export function BookingPaymentSummary({ bookingId }: { bookingId: number }) {
  const { colors: c, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || data) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/bookings/${bookingId}/ledger`);
      const body = await res.json();
      if (!res.ok) setError(String(body.error ?? "Couldn't load the payment details 🙏"));
      else setData(body as Summary);
    } catch {
      setError("Couldn't load the payment details 🙏");
    } finally {
      setLoading(false);
    }
  }

  const muted = { color: c.textMuted, fontSize: fontSize.xs, fontWeight: "700" as const };

  return (
    <View style={[styles.wrap, { borderColor: c.border }]}>
      <Pressable
        onPress={() => void toggle()}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headerLeft}>
          <Wallet size={14} color={c.textMuted} />
          <Text style={[styles.headerText, { color: c.textMuted }]}>Payment details</Text>
        </View>
        {open ? (
          <ChevronUp size={14} color={c.textMuted} />
        ) : (
          <ChevronDown size={14} color={c.textMuted} />
        )}
      </Pressable>

      {open ? (
        <View style={[styles.body, { borderTopColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAF9" }]}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={c.textFaint} />
              <Text style={[styles.loadingText, { color: c.textFaint }]}>Loading…</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {data ? (
            <>
              <View style={{ gap: space[1] }}>
                <View style={styles.row}>
                  <Text style={muted}>Court fee</Text>
                  <Text style={muted}>{formatNPR(data.totals.courtPrice)}</Text>
                </View>
                {data.totals.extrasTotal > 0 ? (
                  <View style={styles.row}>
                    <Text style={muted}>Extras</Text>
                    <Text style={muted}>+ {formatNPR(data.totals.extrasTotal)}</Text>
                  </View>
                ) : null}
                <View style={[styles.row, styles.totalRow, { borderTopColor: c.border }]}>
                  <Text style={[styles.totalLabel, { color: c.text }]}>Total</Text>
                  <Text style={[styles.totalValue, { color: c.text }]}>{formatNPR(data.totals.owed)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.paidLabel, { color: colors.emerald700 }]}>Paid</Text>
                  <Text style={[styles.paidValue, { color: colors.emerald700 }]}>
                    {formatNPR(data.totals.paid)}
                  </Text>
                </View>
              </View>

              {data.totals.balance > 0 ? (
                <Text style={[styles.banner, styles.bannerDue]}>
                  ⏳ {formatNPR(data.totals.balance)} still to pay
                </Text>
              ) : null}
              {data.totals.surplus > 0 ? (
                <Text style={[styles.banner, styles.bannerSurplus]}>
                  💵 You paid {formatNPR(data.totals.surplus)} more than owed — the venue owes you
                  the change
                </Text>
              ) : null}

              {data.payments.filter((p) => !p.voidedAt).length > 0 ? (
                <View style={{ marginTop: space[2.5], gap: space[1] }}>
                  {data.payments
                    .filter((p) => !p.voidedAt)
                    .map((p) => (
                      <View key={p.id} style={styles.row}>
                        <Text style={[styles.lineText, { color: c.textMuted }]} numberOfLines={1}>
                          {p.method}
                          {p.reference ? (
                            <Text style={{ color: c.textFaint }}> • {p.reference.slice(0, 14)}</Text>
                          ) : p.note ? (
                            <Text style={{ color: c.textFaint }}> — {p.note}</Text>
                          ) : null}
                        </Text>
                        <Text style={[styles.lineAmt, { color: c.text }]}>{formatNPR(p.amount)}</Text>
                      </View>
                    ))}
                </View>
              ) : null}

              {data.extras.filter((x) => !x.voidedAt).length > 0 ? (
                <View
                  style={{
                    marginTop: space[2],
                    gap: space[1],
                    borderTopWidth: 1,
                    borderTopColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAF9",
                    paddingTop: space[2],
                  }}
                >
                  {data.extras
                    .filter((x) => !x.voidedAt)
                    .map((x) => (
                      <View key={x.id} style={styles.row}>
                        <Text style={[styles.lineText, { color: c.textMuted }]} numberOfLines={1}>
                          {x.label}
                        </Text>
                        <Text style={[styles.lineAmt, { color: c.text }]}>{formatNPR(x.amount)}</Text>
                      </View>
                    ))}
                </View>
              ) : null}

              {data.payments.filter((p) => !p.voidedAt).length === 0 ? (
                <Text style={[styles.noneYet, { color: c.textFaint }]}>
                  Nothing recorded as paid yet.
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: space[2.5],
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: space[1.5] },
  headerText: { fontSize: fontSize.xs, fontWeight: "900" },
  body: { borderTopWidth: 1, paddingHorizontal: space[3.5], paddingVertical: space[3] },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  loadingText: { fontSize: fontSize.xs, fontWeight: "700" },
  error: { fontSize: fontSize.xs, fontWeight: "700", color: "#DC2626" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] },
  totalRow: { borderTopWidth: 1, paddingTop: space[1], marginTop: space[1] },
  totalLabel: { fontSize: fontSize.xs, fontWeight: "700" },
  totalValue: { fontSize: fontSize.xs, fontWeight: "900" },
  paidLabel: { fontSize: fontSize.xs, fontWeight: "700" },
  paidValue: { fontSize: fontSize.xs, fontWeight: "900" },
  banner: {
    marginTop: space[2],
    borderRadius: radius.lg,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: fontSize.xs,
    fontWeight: "900",
    overflow: "hidden",
  },
  bannerDue: { backgroundColor: "#FFFBEB", color: "#B45309" },
  bannerSurplus: { backgroundColor: "#F0F9FF", color: "#0369A1" },
  lineText: { flex: 1, minWidth: 0, fontSize: fontSize.xs, fontWeight: "700" },
  lineAmt: { fontSize: fontSize.xs, fontWeight: "900" },
  noneYet: { marginTop: space[2], fontSize: fontSize.xs, fontWeight: "700" },
});
