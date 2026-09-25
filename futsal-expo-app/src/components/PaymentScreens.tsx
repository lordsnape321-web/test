import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, CreditCard, Loader2, PartyPopper, ShieldCheck, XCircle } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api";
import { formatNPR } from "@/lib/futsal";
import { leaguePaymentsAction, verifyEsewa, verifyKhalti } from "@/api";
import { useTheme } from "@/context/ThemeContext";
import { colors, fontSize, radius, space } from "@/theme";

type Params = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function numberParam(value: string | string[] | undefined): number {
  const n = Number(one(value));
  return Number.isFinite(n) ? n : 0;
}

/** Native versions of the hosted gateway pages used by the web app. */
export function EsewaMockScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const leagueId = one(params.leagueId);
  const requestId = one(params.paymentRequestId);
  return <GatewayMock kind="esewa" params={params} onDone={(id) => router.replace(leagueId ? `/leagues/${leagueId}?paid=1` : `/payment/esewa/success?mock=1&bookingId=${id}${requestId ? `&paymentRequestId=${requestId}` : ""}`)} onCancel={(id) => router.replace(leagueId ? `/leagues/${leagueId}` : `/payment/esewa/failure?bookingId=${id}`)} />;
}

export function KhaltiMockScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const leagueId = one(params.leagueId);
  const requestId = one(params.paymentRequestId);
  return <GatewayMock kind="khalti" params={params} onDone={(id) => router.replace(leagueId ? `/leagues/${leagueId}?paid=1` : `/payment/khalti/callback?mock=1&pidx=${encodeURIComponent(one(params.pidx))}&bookingId=${id}${requestId ? `&paymentRequestId=${requestId}` : ""}&status=Completed`)} onCancel={(id) => router.replace(leagueId ? `/leagues/${leagueId}` : `/payment/khalti/callback?bookingId=${id}&status=User%20canceled`)} />;
}

function GatewayMock({ kind, params, onDone, onCancel }: { kind: "esewa" | "khalti"; params: Params; onDone: (bookingId: string) => void; onCancel: (bookingId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bookingId = one(params.bookingId);
  const teamPaymentId = one(params.teamPaymentId);
  const paymentRequestId = one(params.paymentRequestId);
  const leagueId = one(params.leagueId);
  const teamId = one(params.teamId);
  const amount = numberParam(params.amount);
  const isLeague = Boolean(leagueId && teamId);
  const purple = kind === "khalti";
  const accent = purple ? "#5C2D91" : "#087443";
  const soft = purple ? "#FAF5FF" : colors.emerald50;
  const label = purple ? "Khalti" : "eSewa";

  async function pay() {
    setBusy(true);
    setError("");
    try {
      if (isLeague) {
        await leaguePaymentsAction(Number(leagueId), {
          action: "verify",
          mockApprove: true,
          userId: numberParam(params.userId),
          teamId: Number(teamId),
          amount,
          method: label,
        });
      } else if (kind === "esewa") {
        await verifyEsewa(Number(bookingId), true, teamPaymentId ? Number(teamPaymentId) : undefined, paymentRequestId ? Number(paymentRequestId) : undefined, numberParam(params.userId) || undefined);
      } else {
        await verifyKhalti(Number(bookingId), one(params.pidx) || "mock-pidx", true, teamPaymentId ? Number(teamPaymentId) : undefined, paymentRequestId ? Number(paymentRequestId) : undefined, numberParam(params.userId) || undefined);
      }
      if (isLeague) {
        // League checkout returns to its detail page, just like the web mock.
        onDone(bookingId);
      } else {
        onDone(bookingId);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Mock payment failed. Nothing was charged.");
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: accent }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.gatewayScroll}>
        <View style={styles.gatewayCard}>
          <View style={[styles.gatewayHead, { backgroundColor: accent }]}>
            <Text style={styles.gatewayName}>{label}</Text>
            <Text style={styles.sandbox}>Sandbox simulator • test mode</Text>
          </View>
          <View style={styles.gatewayBody}>
            <View style={[styles.amountCard, { backgroundColor: soft }]}>
              <Text style={[styles.amountKicker, { color: accent }]}>Paying to FutsalNepal test store</Text>
              <Text style={[styles.amount, { color: purple ? "#4C1D95" : "#064E3B" }]}>{formatNPR(amount)}</Text>
              <Text style={[styles.reference, { color: accent }]}>{isLeague ? `league #${leagueId} • squad #${teamId}` : `booking #${bookingId}`}</Text>
            </View>
            <View style={styles.testInfo}><Text style={styles.testText}>This is a safe test checkout. No real money moves.</Text><Text style={styles.testText}>The server ledger and payment statuses use the same verified path as production.</Text></View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable onPress={() => void pay()} disabled={busy} style={[styles.payButton, { backgroundColor: accent }]}>
              {busy ? <Loader2 size={18} color="#FFFFFF" /> : <ShieldCheck size={18} color="#FFFFFF" />}
              <Text style={styles.payText}>{busy ? "Processing…" : `Pay ${formatNPR(amount)}`}</Text>
            </Pressable>
            <Pressable onPress={() => onCancel(bookingId)} disabled={busy} style={styles.cancelButton}><XCircle size={17} color={colors.stone500} /><Text style={styles.cancelText}>Cancel payment</Text></Pressable>
            <Text style={styles.disclaimer}>You can return to My Bookings and try again whenever you&apos;re ready.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function EsewaSuccessScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const bookingId = one(params.bookingId);
  const mock = one(params.mock) === "1";
  return <ResultScreen kind="success" gateway="eSewa" bookingId={bookingId} message={mock ? "eSewa test payment confirmed." : "Your eSewa response has been received."} onPrimary={() => router.replace("/bookings")} onSecondary={() => router.replace("/venues")} />;
}

export function EsewaFailureScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  return <ResultScreen kind="failure" gateway="eSewa" bookingId={one(params.bookingId)} message="No money moved. Your booking is still waiting — pay from My Bookings whenever you are ready." onPrimary={() => router.replace("/bookings")} onSecondary={() => router.replace("/venues")} />;
}

export function KhaltiCallbackScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const bookingId = one(params.bookingId);
  const teamPaymentId = one(params.teamPaymentId);
  const paymentRequestId = one(params.paymentRequestId);
  const [state, setState] = useState<"loading" | "success" | "failure">(one(params.status) === "Completed" || one(params.mock) === "1" ? "success" : "loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (state !== "loading") return;
    const pidx = one(params.pidx);
    if (!pidx || !bookingId) {
      setState("failure");
      setMessage("Missing Khalti session. Check My Bookings for status.");
      return;
    }
    verifyKhalti(Number(bookingId), pidx, false, teamPaymentId ? Number(teamPaymentId) : undefined, paymentRequestId ? Number(paymentRequestId) : undefined, numberParam(params.userId) || undefined)
      .then(() => setState("success"))
      .catch((e) => {
        setState("failure");
        setMessage(e instanceof Error ? e.message : "Verification failed");
      });
  }, [bookingId, params, state]);

  if (state === "loading") return <LoadingResult label="Verifying Khalti payment… 💜" />;
  return <ResultScreen kind={state === "success" ? "success" : "failure"} gateway="Khalti" bookingId={bookingId} message={state === "success" ? "Khalti test payment confirmed." : message || "Could not verify the payment."} onPrimary={() => router.replace("/bookings")} onSecondary={() => router.replace("/venues")} />;
}

function LoadingResult({ label }: { label: string }) {
  const { colors: c } = useTheme();
  return <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["bottom"]}><View style={styles.loading}><Loader2 size={44} color={colors.emerald600} /><Text style={[styles.loadingText, { color: c.text }]}>{label}</Text></View></SafeAreaView>;
}

function ResultScreen({ kind, gateway, bookingId, message, onPrimary, onSecondary }: { kind: "success" | "failure"; gateway: string; bookingId: string; message: string; onPrimary: () => void; onSecondary: () => void }) {
  const { colors: c } = useTheme();
  const success = kind === "success";
  return <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["bottom"]}><ScrollView contentContainerStyle={styles.resultScroll}><View style={[styles.resultCard, { backgroundColor: c.surface, borderColor: c.border }]}><View style={[styles.resultIcon, { backgroundColor: success ? colors.emerald600 : colors.red500 }]}>{success ? <PartyPopper size={32} color="#FFFFFF" /> : <XCircle size={32} color="#FFFFFF" />}</View><Text style={[styles.resultTitle, { color: c.text }]}>{success ? "Payment verified! 🎉" : `${gateway} payment cancelled 😌`}</Text><Text style={[styles.resultBody, { color: c.textMuted }]}>{message}{bookingId ? ` Booking #FN-${bookingId}.` : ""}</Text><View style={styles.resultActions}><Pressable onPress={onPrimary} style={[styles.resultPrimary, { backgroundColor: colors.emerald600 }]}><CheckCircle2 size={16} color="#FFFFFF" /><Text style={styles.resultPrimaryText}>{success ? "Track booking" : "Pay from bookings"}</Text></Pressable><Pressable onPress={onSecondary} style={[styles.resultSecondary, { borderColor: c.border }]}><CreditCard size={16} color={c.text} /><Text style={[styles.resultSecondaryText, { color: c.text }]}>Browse courts</Text></Pressable></View></View></ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gatewayScroll: { flexGrow: 1, justifyContent: "center", padding: space[4] },
  gatewayCard: { width: "100%", maxWidth: 440, alignSelf: "center", overflow: "hidden", borderRadius: 32, backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  gatewayHead: { padding: space[6], alignItems: "center" },
  gatewayName: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", fontStyle: "italic" },
  sandbox: { color: "rgba(255,255,255,0.9)", backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5, marginTop: 8, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  gatewayBody: { padding: space[6], gap: space[3] },
  amountCard: { borderRadius: radius["2xl"], padding: space[4], alignItems: "center" },
  amountKicker: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1, textAlign: "center" },
  amount: { fontSize: 30, fontWeight: "900", marginTop: 4 },
  reference: { fontSize: 11, fontWeight: "700", marginTop: 4 },
  testInfo: { borderWidth: 1, borderStyle: "dashed", borderColor: "#E7E5E4", borderRadius: radius.xl, padding: space[3], gap: 3 },
  testText: { color: colors.stone500, fontSize: fontSize.xs, lineHeight: 17 },
  error: { color: colors.red600, backgroundColor: colors.red50, borderRadius: radius.xl, padding: space[3], fontSize: fontSize.xs, fontWeight: "800" },
  payButton: { minHeight: 50, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  payText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  cancelButton: { minHeight: 46, borderWidth: 1, borderColor: "#E7E5E4", borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  cancelText: { color: colors.stone500, fontSize: fontSize.base, fontWeight: "800" },
  disclaimer: { color: colors.stone400, fontSize: fontSize.xs, textAlign: "center", lineHeight: 17 },
  resultScroll: { flexGrow: 1, justifyContent: "center", padding: space[4] },
  resultCard: { width: "100%", maxWidth: 440, alignSelf: "center", borderWidth: 1, borderRadius: 32, padding: space[8], alignItems: "center" },
  resultIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: fontSize["2xl"], fontWeight: "900", textAlign: "center", marginTop: space[4] },
  resultBody: { fontSize: fontSize.base, lineHeight: 20, textAlign: "center", marginTop: space[2] },
  resultActions: { width: "100%", gap: space[2], marginTop: space[6] },
  resultPrimary: { minHeight: 48, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  resultPrimaryText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  resultSecondary: { minHeight: 48, borderWidth: 1, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  resultSecondaryText: { fontSize: fontSize.base, fontWeight: "900" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], padding: space[6] },
  loadingText: { fontSize: fontSize.lg, fontWeight: "900", textAlign: "center" },
});
