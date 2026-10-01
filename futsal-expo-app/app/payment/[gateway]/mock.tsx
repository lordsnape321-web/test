import { useLocalSearchParams, useRouter } from "expo-router";
import { Loader2, ShieldCheck } from "lucide-react-native";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";
import { canRetryCheckout, pendingRecord, retryLastCheckout } from "@/lib/checkout";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Where the demo checkout used to be.
 *
 * `/payment/esewa/mock?…` and `/payment/khalti/mock?…` were a screen inside the
 * app — the three-step replica, and before that the route a phone was sent to
 * when a gateway could not be reached. The replica is a page the backend serves
 * now (`/api/payments/{gateway}/demo`, from `laravel/public/demo-*.html`), so
 * nothing in this app links here any more.
 *
 * It still answers, for a link that was written down before that: a build whose
 * bundle is older than the page, a bookmark, a tab left open. It does not
 * settle anything by itself — it re-runs the checkout this session started, and
 * the server answers with the page to open, exactly as the Pay button does.
 */
export default function LegacyDemoCheckout() {
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;
  const { colors: c } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const gateway = String(params.gateway ?? "") === "khalti" ? "Khalti" : "eSewa";
  const record = pendingRecord();
  const resumable = canRetryCheckout();

  async function resume() {
    setBusy(true);
    setMessage("");

    const outcome = await retryLastCheckout("demo");

    setBusy(false);

    if (outcome.status === "gateway") return;

    setMessage(
      outcome.status === "error"
        ? outcome.message
        : "This payment is not being tracked any more — start it again from My Bookings.",
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["bottom"]}>
      <View style={styles.body}>
        <View style={[styles.icon, { backgroundColor: colors.emerald600 }]}>
          <ShieldCheck size={28} color="#FFFFFF" />
        </View>
        <Text style={[styles.title, { color: c.text }]}>The {gateway} demo checkout has moved</Text>
        <Text style={[styles.copy, { color: c.textMuted }]}>
          {resumable
            ? `It is a page now, served by the app's own backend — the same steps, the same payment.${
                record?.label ? ` You were paying ${record.label}.` : ""
              }`
            : "It is a page served by the app's own backend now. Nothing is waiting on this link, so start the payment from the booking."}
        </Text>

        {message ? <Text style={[styles.error, { color: colors.red500 }]}>{message}</Text> : null}

        <Pressable
          onPress={resumable ? resume : () => router.replace("/bookings?refresh=1")}
          disabled={busy}
          style={[styles.action, { backgroundColor: colors.emerald600, opacity: busy ? 0.7 : 1 }]}
        >
          {busy ? (
            <Loader2 size={18} color="#FFFFFF" />
          ) : (
            <Text style={styles.actionText}>
              {resumable ? "Continue to the demo checkout" : "Go to My Bookings"}
            </Text>
          )}
        </Pressable>

        {resumable ? (
          <Pressable onPress={() => router.replace("/bookings?refresh=1")} style={styles.ghost}>
            <Text style={[styles.ghostText, { color: c.textMuted }]}>Back to My Bookings</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
    paddingHorizontal: space[6],
  },
  icon: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: fontSize.lg, fontWeight: "700", textAlign: "center" },
  copy: { fontSize: fontSize.sm, lineHeight: 20, textAlign: "center" },
  error: { fontSize: fontSize.sm, lineHeight: 20, textAlign: "center" },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.lg,
    paddingVertical: space[3],
    paddingHorizontal: space[6],
    minWidth: 240,
  },
  actionText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "700" },
  ghost: { paddingVertical: space[2] },
  ghostText: { fontSize: fontSize.sm, fontWeight: "600" },
});
