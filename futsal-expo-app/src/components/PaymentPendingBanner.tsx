import { CheckCircle2, RefreshCw, Wallet, X } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  checkLastCheckout,
  clearCheckout,
  pendingCheckout,
  restorePendingCheckout,
  subscribeCheckout,
  type RememberedCheckout,
} from "@/lib/checkout";
import { useTheme } from "@/context/ThemeContext";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * "A payment is still open" — shown on the screens a player returns to.
 *
 * Leaving for eSewa or Khalti happens in another app, and nothing forces the
 * player to come back to a particular screen: they can switch back to the app
 * on any page, at any point, or just put the phone down. Without this, a
 * half-finished payment looked like nothing had happened at all — the booking
 * still read unpaid and there was no hint that a checkout was in flight.
 *
 * So the checkout that was started is remembered (see `src/lib/checkout.ts`)
 * and this card says so, with one button to ask the gateway what happened. It
 * also checks by itself when the app comes back to the foreground, so a payment
 * that *did* go through settles without the player doing anything.
 */
export function PaymentPendingBanner({ onSettled }: { onSettled?: () => void }) {
  const { colors: c } = useTheme();
  const router = useRouter();
  const [attempt, setAttempt] = useState<RememberedCheckout | null>(pendingCheckout);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [settled, setSettled] = useState("");
  const lastCheck = useRef(0);

  // Bring back a checkout that outlived the app (a reload, or a cold start
  // after the player paid in the browser), then follow the store — a payment
  // can start on another screen, or settle while this one is mounted.
  useEffect(() => {
    restorePendingCheckout();
    setAttempt(pendingCheckout());

    return subscribeCheckout(() => setAttempt(pendingCheckout()));
  }, []);

  async function check(auto = false) {
    const pending = pendingCheckout();

    if (!pending?.check || busy) return;

    lastCheck.current = Date.now();

    if (!auto) setBusy(true);
    setMessage("");

    const outcome = await checkLastCheckout();

    if (outcome.status === "settled") {
      setSettled(outcome.message);
      setBusy(false);
      onSettled?.();
      return;
    }

    setBusy(false);
    if (!auto && outcome.status === "open") setMessage(outcome.message);
  }

  /*
   * Coming back to the app is the moment to look: the player may have finished
   * on the gateway's page, or abandoned it. Only once every 20 seconds, so
   * flicking between apps does not hammer the API.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (Date.now() - lastCheck.current < 20_000) return;

      void check(true);
    });

    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!attempt || (!attempt.check && !attempt.mockPath && !attempt.settle)) return null;

  if (settled) {
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: colors.emerald600 }]}>
        <View style={styles.head}>
          <CheckCircle2 size={18} color={colors.emerald600} />
          <Text style={[styles.title, { color: c.text }]}>Payment confirmed</Text>
        </View>
        <Text style={[styles.body, { color: c.textMuted }]}>{settled}</Text>
        <Pressable
          onPress={() => {
            clearCheckout();
            setSettled("");
          }}
          style={[styles.action, { borderColor: c.border }]}
        >
          <Text style={[styles.actionText, { color: c.text }]}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.head}>
        <Wallet size={16} color={colors.amber400} />
        <Text style={[styles.title, { color: c.text }]}>Payment in progress</Text>
        <Pressable
          onPress={() => {
            clearCheckout();
            setMessage("");
          }}
          hitSlop={8}
          style={styles.dismiss}
        >
          <X size={16} color={c.textFaint} />
        </Pressable>
      </View>

      <Text style={[styles.body, { color: c.textMuted }]}>
        {attempt.label} was started in the browser. If you finished it, check now — if you did not, it is
        still waiting.
      </Text>

      {message ? <Text style={[styles.body, { color: colors.red600 }]}>{message}</Text> : null}

      <View style={styles.actions}>
        {attempt.check ? (
          <Pressable
            onPress={() => void check()}
            disabled={busy}
            style={[styles.action, { borderColor: colors.emerald600 }]}
          >
            <RefreshCw size={14} color={colors.emerald600} />
            <Text style={[styles.actionText, { color: colors.emerald600 }]}>
              {busy ? "Checking…" : "Check payment"}
            </Text>
          </Pressable>
        ) : null}

        {attempt.mockPath || attempt.settle ? (
          <Pressable
            onPress={() => {
              if (attempt.mockPath) {
                router.push(attempt.mockPath as never);
                return;
              }

              void (async () => {
                setBusy(true);
                try {
                  const line = await attempt.settle?.();
                  if (line) setSettled(line);
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "That payment could not be recorded.");
                } finally {
                  setBusy(false);
                }
              })();
            }}
            disabled={busy}
            style={[styles.action, { borderColor: c.border }]}
          >
            <Text style={[styles.actionText, { color: c.text }]}>Finish on the simulator</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius["2xl"],
    padding: space[4],
    gap: space[2],
    marginBottom: space[3],
  },
  head: { flexDirection: "row", alignItems: "center", gap: space[2] },
  title: { flex: 1, fontSize: fontSize.base, fontWeight: "900" },
  dismiss: { padding: 2 },
  body: { fontSize: fontSize.xs, lineHeight: 18 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] },
  action: {
    minHeight: 38,
    paddingHorizontal: space[3],
    borderWidth: 1,
    borderRadius: radius.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  actionText: { fontSize: fontSize.xs, fontWeight: "800" },
});
