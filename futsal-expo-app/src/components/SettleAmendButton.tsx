import { Lock, RotateCcw } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatWindowLeft, settleWindow } from "@/lib/booking-ledger";
import { fontSize, radius } from "@/theme";

/**
 * The Amend control for a settled booking row.
 *
 * The countdown owns its own one-second clock on purpose. When the clock lived
 * on the bookings page, every tick re-rendered the whole table — every row,
 * every badge — once a second. Keeping it here means only rows that are
 * actually inside a correction window re-render at all.
 *
 * The clock also stops itself once the window closes: there is nothing left to
 * count down, so leaving the interval running would just burn renders forever.
 */
export function SettleAmendButton({
  settledAt,
  onOpen,
}: {
  settledAt: string | null;
  onOpen: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const win = settleWindow(settledAt, now);

  useEffect(() => {
    // Nothing to tick for a booking that was never settled.
    if (!win.settled) return;
    const t = setInterval(() => {
      setNow(Date.now());
      // Stop once it locks; the button has become a static pill.
      if (Date.now() >= (win.locksAt ?? Infinity)) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [win.settled, win.locksAt]);

  if (!win.settled) return null;

  if (!win.editable) {
    return (
      <View
        style={styles.locked}
        accessibilityLabel="Settled and locked — the 5-minute correction window has closed"
      >
        <Lock size={14} color="#64748B" />
        <Text style={styles.lockedText}>Locked</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Amend this settled payment — locks in ${formatWindowLeft(win.msLeft)}`}
      style={styles.amend}
    >
      <RotateCcw size={14} color="#FFFFFF" />
      <Text style={styles.amendLabel}>Amend</Text>
      {/* Fixed min-width keeps "4:32" and "4:09" equal so the row doesn't jitter. */}
      <Text style={[styles.amendTimer, { minWidth: 36 }]}>
        {formatWindowLeft(win.msLeft)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  amend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F59E0B",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    height: 32,
  },
  amendLabel: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  amendTimer: {
    color: "#FFFFFF",
    fontSize: fontSize.xs,
    fontWeight: "900",
    textAlign: "right",
  },
  locked: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#E2E8F0",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    height: 32,
  },
  lockedText: { color: "#64748B", fontSize: fontSize.xs, fontWeight: "900" },
});
