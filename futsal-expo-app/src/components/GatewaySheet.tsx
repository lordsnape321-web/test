import { ChevronLeft, Lock } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import {
  closeInAppGateway,
  currentInAppGateway,
  formBody,
  isReturnUrl,
  returnParams,
  subscribeInAppGateway,
  type InAppGatewaySession,
} from "@/lib/inapp-gateway";
import { paymentWebOrigin } from "@/lib/gateway";
import { useTheme } from "@/context/ThemeContext";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Paying without leaving the app.
 *
 * On the web the checkout opens a tab — correct there, because the browser is
 * where the app lives. On a phone it is not: a system browser hides the app,
 * makes the player find their way back, and (in Expo Go) the deep link that
 * brings them back is a prompt they can dismiss. So the gateway page runs here
 * instead, in a WebView, between the app and the internet.
 *
 * The sheet owns exactly two jobs:
 *
 *  • make the request the gateway expects — a POST of the signed eSewa form, or
 *    the `payment_url` Khalti issued;
 *  • notice the return URL before it loads, close, and hand the query to the
 *    in-app route that verifies it. Verification stays where it always was
 *    (`/payment/esewa/success`, `/payment/khalti/callback`), so there is one
 *    implementation of "was this paid", not two.
 */
export function GatewaySheet() {
  const { colors: c } = useTheme();
  const router = useRouter();
  const [session, setSession] = useState<InAppGatewaySession | null>(currentInAppGateway);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  // The return URL can arrive twice (a redirect chain); the first one wins.
  const handled = useRef(false);

  useEffect(() => {
    setSession(currentInAppGateway());

    return subscribeInAppGateway(() => {
      setSession(currentInAppGateway());
      setLoading(true);
      setProblem("");
      handled.current = false;
    });
  }, []);

  const source = useMemo(() => {
    if (!session) return null;

    if (session.fields && Object.keys(session.fields).length > 0) {
      return {
        uri: session.url,
        method: "POST" as const,
        body: formBody(session.fields),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      };
    }

    return { uri: session.url };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!session || !source || Platform.OS === "web") return null;

  /**
   * The checkout is over: close the sheet and go where the page sent us.
   *
   * A real gateway returns to `/payment/esewa/success?data=…` or
   * `/payment/khalti/callback?pidx=…`; the replica returns to whichever of the
   * app's screens started it, so a page that is not one of those two is pushed
   * as the app route it names (a league's own page, for instance).
   */
  function finish(url: string) {
    if (handled.current) return;
    handled.current = true;

    const params = returnParams(url);
    const query = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    const origin = paymentWebOrigin();
    const path = origin && url.startsWith(origin) ? url.slice(origin.length) : "";

    closeInAppGateway();

    if (path.startsWith("/payment/esewa")) {
      // Everything eSewa appended is carried through. A real success is the
      // signed `data` blob; the demo checkout says `mock=1`, having already
      // posted to `verify`; and a failure carries whatever reason eSewa chose
      // to give, which is worth showing rather than swallowing.
      router.push(
        (params.mock === "1"
          ? `/payment/esewa/success${query ? `?${query}` : ""}`
          : params.data
            ? `/payment/esewa/success?data=${encodeURIComponent(params.data)}`
            : `/payment/esewa/failure${query ? `?${query}` : ""}`) as never,
      );
      return;
    }

    if (path.startsWith("/payment/khalti")) {
      router.push(`/payment/khalti/callback?${query}` as never);
      return;
    }

    if (path) router.push(path as never);
  }

  /**
   * The player backed out of the gateway's page.
   *
   * The checkout is *not* forgotten: eSewa may have taken the money anyway, and
   * the pending card is the only thing that knows to ask. It stays until the
   * gateway or the player says otherwise.
   */
  function cancel() {
    closeInAppGateway();
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: c.bg }]}>
      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        <View style={[styles.header, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Pressable onPress={cancel} hitSlop={10} style={styles.back}>
            <ChevronLeft size={20} color={c.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: c.text }]}>
              {session.demo
                ? session.method === "esewa" ? "eSewa — demo checkout" : "Khalti — demo checkout"
                : session.method === "esewa" ? "eSewa test server" : "Khalti test server"}
            </Text>
            <View style={styles.subRow}>
              <Lock size={11} color={colors.emerald600} />
              <Text style={[styles.sub, { color: c.textMuted }]}>
                {session.label}
                {/* eSewa's own reference for this attempt: support asks for it,
                    and it is how the status API names the session afterwards. */}
                {session.fields?.transaction_uuid ? ` · ref ${session.fields.transaction_uuid}` : ""}
              </Text>
            </View>
            {session.detail ? (
              <Text style={[styles.detail, { color: c.text }]}>{session.detail}</Text>
            ) : null}
          </View>
        </View>

        {session.note ? (
          <Text style={[styles.note, { color: c.textMuted, borderColor: c.border, backgroundColor: c.surface }]}>
            {session.note}
          </Text>
        ) : null}

        {problem ? (
          <View style={[styles.problem, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.problemText, { color: c.text }]}>{problem}</Text>
            <Pressable onPress={cancel} style={[styles.problemButton, { borderColor: c.border }]}>
              <Text style={[styles.problemButtonText, { color: c.text }]}>Back to the app</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.flex}>
            <WebView
              source={source}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              startInLoadingState
              onLoadEnd={() => setLoading(false)}
              onError={(event) =>
                setProblem(
                  event.nativeEvent.description ||
                    "The gateway's page could not be loaded. Check the connection and try again.",
                )
              }
              onHttpError={(event) =>
                setProblem(`The gateway answered ${event.nativeEvent.statusCode}. Nothing was charged.`)
              }
              onShouldStartLoadWithRequest={(request: ShouldStartLoadRequest) => {
                if (isReturnUrl(request.url, session.returnPrefixes)) {
                  finish(request.url);
                  return false;
                }

                return true;
              }}
            />

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator size="large" color={colors.emerald600} />
                <Text style={[styles.loadingText, { color: c.textMuted }]}>
                  Opening {session.method === "esewa" ? "eSewa" : "Khalti"}…
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 50 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderBottomWidth: 1,
  },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  title: { fontSize: fontSize.base, fontWeight: "900" },
  subRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  sub: { fontSize: fontSize.xs, fontWeight: "700" },
  detail: { fontSize: fontSize.sm, fontWeight: "800", marginTop: 2 },
  note: {
    fontSize: fontSize.xs,
    lineHeight: 17,
    fontWeight: "700",
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderBottomWidth: 1,
  },
  loading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
  },
  loadingText: { fontSize: fontSize.xs, fontWeight: "700" },
  problem: { margin: space[4], padding: space[4], borderWidth: 1, borderRadius: radius["2xl"], gap: space[3] },
  problemText: { fontSize: fontSize.sm, lineHeight: 20 },
  problemButton: { minHeight: 42, borderWidth: 1, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  problemButtonText: { fontSize: fontSize.xs, fontWeight: "800" },
});
