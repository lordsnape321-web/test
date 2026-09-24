import { Crown, LogIn } from "lucide-react-native";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * OwnerGuard — gates every Owner Studio screen.
 *
 * Same three states as the web component: loading skeleton, signed-out card,
 * "owners only" card for a player account, then the children.
 */
export function OwnerGuard({ children }: { children: React.ReactNode }) {
  const { user, ready, isOwner, signOut } = useAuth();
  const { colors: c, isDark } = useTheme();
  const router = useRouter();

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={c.textFaint} />
        <Text style={[styles.loadingText, { color: c.textMuted }]}>Opening Owner Studio…</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.iconWrap, { backgroundColor: c.text }]}>
            <Crown size={28} color={colors.amber400} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>Owner sign-in required</Text>
          <Text style={[styles.body, { color: c.textMuted }]}>
            Owner Studio is exclusive to venue owners. Log in with an owner account or create one
            to list your arena.
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => router.push("/login")}
              style={[styles.btn, styles.btnSecondary, { borderColor: c.border }]}
            >
              <LogIn size={16} color={c.text} />
              <Text style={[styles.btnSecondaryText, { color: c.text }]}>Log in</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/signup")} style={[styles.btn, styles.btnPrimary]}>
              <Text style={styles.btnPrimaryText}>Sign up free</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (!isOwner) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.crownEmoji, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9" }]}>
            👑
          </Text>
          <Text style={[styles.title, { color: c.text }]}>Owners only</Text>
          <Text style={[styles.body, { color: c.textMuted }]}>
            You&apos;re signed in as <Text style={{ fontWeight: "800", color: c.text }}>{user.name}</Text>{" "}
            (player). Owner Studio needs a venue-owner account.
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                void signOut().then(() => router.push("/signup"));
              }}
              style={[styles.btn, styles.btnPrimary]}
            >
              <Text style={styles.btnPrimaryText}>Become an owner</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/venues")}
              style={[styles.btn, styles.btnSecondary, { borderColor: c.border }]}
            >
              <Text style={[styles.btnSecondaryText, { color: c.text }]}>Book as player</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
    gap: space[3],
  },
  loadingText: { fontSize: fontSize.base, fontWeight: "700" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[4],
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[8],
    alignItems: "center",
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  crownEmoji: {
    width: 64,
    height: 64,
    borderRadius: radius["2xl"],
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 28,
    lineHeight: 64,
    overflow: "hidden",
  },
  title: { marginTop: space[4], fontSize: fontSize["2xl"], fontWeight: "900", textAlign: "center" },
  body: {
    marginTop: space[2],
    fontSize: fontSize.base,
    lineHeight: 20,
    textAlign: "center",
  },
  actions: {
    marginTop: space[6],
    flexDirection: "row",
    gap: space[2],
    alignSelf: "stretch",
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "transparent",
    paddingVertical: space[3],
    minHeight: 44,
  },
  btnPrimary: { backgroundColor: "#0F172A" },
  btnPrimaryText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  btnSecondary: { borderWidth: 1, backgroundColor: "transparent" },
  btnSecondaryText: { fontSize: fontSize.sm, fontWeight: "900" },
});
