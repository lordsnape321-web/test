import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme, type ThemeMode } from "@/context/ThemeContext";
import { trustLabel } from "@/lib/loyalty";
import { fontSize, radius, space } from "@/theme";

/**
 * Profile, appearance and sign out.
 *
 * The trust label and rating rendering reuse src/lib/loyalty.ts — the same module
 * the web player profile uses — so the thresholds that decide "Trusted" versus
 * "Needs deposit" are identical on both platforms rather than re-implemented.
 */
export default function AccountScreen() {
  const { colors } = useTheme();
  const { user, signOut } = useAuth();
  const { mode, setMode } = useTheme();

  if (!user) return null;

  const trust = user.trustScore ?? 100;
  const rating = user.rating ?? 0;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={[styles.avatarText, { color: colors.primaryText }]}>
              {initials(user.name)}
            </Text>
          </View>
          <Text style={[styles.name, { color: colors.text }]}>{user.name}</Text>
          <Text style={[styles.email, { color: colors.textMuted }]}>{user.email}</Text>
          <Text style={[styles.phone, { color: colors.textMuted }]}>{user.phone}</Text>
        </View>

        <Card>
          <StatRow label="Trust score" value={String(trust)} colors={colors} />
          <StatRow
            label="Trust label"
            value={`${trustLabel(trust).emoji} ${trustLabel(trust).label}`}
            colors={colors}
          />
          <StatRow label="Rating" value={`★ ${rating.toFixed(1)}`} colors={colors} />
          <StatRow
            label="Matches played"
            value={String(user.matchesPlayed ?? 0)}
            colors={colors}
          />
          <StatRow label="Level" value={user.level ?? "—"} colors={colors} />
          <StatRow label="Position" value={user.position ?? "—"} colors={colors} />
        </Card>

        <Text style={[styles.section, { color: colors.text }]}>Appearance</Text>
        <View style={styles.modeRow}>
          {(["light", "dark", "system"] as ThemeMode[]).map((m) => {
            const active = m === mode;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.modeChip,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? colors.primaryText : colors.text,
                    fontSize: fontSize.sm,
                    fontWeight: "600",
                    textTransform: "capitalize",
                  }}
                >
                  {m}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Button label="Sign out" variant="danger" onPress={signOut} style={{ marginTop: space.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function StatRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: { text: string; textMuted: string };
}) {
  return (
    <View style={styles.statRow}>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: fontSize.sm, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space.lg, paddingBottom: space.xxxl },
  header: { alignItems: "center", marginBottom: space.xl },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  avatarText: { fontSize: fontSize.xl, fontWeight: "700" },
  name: { fontSize: fontSize.xl, fontWeight: "700" },
  email: { fontSize: fontSize.sm, marginTop: 2 },
  phone: { fontSize: fontSize.sm },
  section: { fontSize: fontSize.base, fontWeight: "700", marginTop: space.xl, marginBottom: space.sm },
  modeRow: { flexDirection: "row", gap: space.sm },
  modeChip: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: space.xs,
  },
});
