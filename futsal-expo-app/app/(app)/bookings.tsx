import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Empty, Notice, Pill, Spinner } from "@/components/ui";
import { fetchBookings } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR, prettyDate } from "@/lib/futsal";
import type { Booking } from "@/lib/types";
import { fontSize, space } from "@/theme";

/**
 * The signed-in player's bookings, newest first.
 *
 * useFocusEffect rather than useEffect so the list re-reads when the user comes
 * back from a booking they just paid for. Without it, a freshly paid booking
 * would still show "unpaid" until the app was restarted.
 */
export default function BookingsScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const list = await fetchBookings({ userId: user.id });
      // Newest first; the API does not guarantee an order.
      setBookings([...list].sort((a, b) => b.id - a.id));
    } catch (e) {
      setError(e instanceof Error ? `Could not load bookings. ${e.message}` : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]} edges={["top"]}>
      {error ? (
        <View style={styles.noticeWrap}>
          <Notice message={error} />
        </View>
      ) : null}

      {loading ? (
        <Spinner label="Loading your bookings…" />
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Empty message="No bookings yet. Find a venue and grab a court!" />
          }
          renderItem={({ item }) => (
            <BookingCard booking={item} onPress={() => router.push(`/booking/${item.id}`)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function BookingCard({ booking, onPress }: { booking: Booking; onPress: () => void }) {
  const { colors } = useTheme();
  const balance = booking.totalPrice - booking.paidAmount;

  return (
    <Card onPress={onPress}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={[styles.venueName, { color: colors.text }]} numberOfLines={1}>
            {booking.venue?.name ?? "Venue"}
          </Text>
          <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
            {booking.court?.name ?? "Court"} · {prettyDate(booking.date)} · {booking.startTime}–
            {booking.endTime}
          </Text>
        </View>
        <StatusPills booking={booking} />
      </View>

      <View style={[styles.moneyRow, { borderTopColor: colors.border }]}>
        <Text style={{ color: colors.textMuted, fontSize: fontSize.base }}>
          {formatNPR(booking.totalPrice)} total
        </Text>
        <Text
          style={{
            color: balance > 0 ? "#B45309" : "#047857",
            fontSize: fontSize.base,
            fontWeight: "700",
          }}
        >
          {balance > 0 ? `${formatNPR(balance)} due` : "Paid"}
        </Text>
      </View>
    </Card>
  );
}

function StatusPills({ booking }: { booking: Booking }) {
  const statusTone =
    booking.status === "confirmed"
      ? "success"
      : booking.status === "cancelled"
        ? "danger"
        : booking.status === "completed"
          ? "info"
          : "warning";

  const payTone =
    booking.paymentStatus === "paid"
      ? "success"
      : booking.paymentStatus === "overpaid"
        ? "info"
        : booking.paymentStatus === "deposit_paid"
          ? "warning"
          : "danger";

  return (
    <View style={styles.pillCol}>
      <Pill label={booking.status} tone={statusTone} />
      <Pill label={booking.paymentStatus.replace("_", " ")} tone={payTone} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noticeWrap: { paddingHorizontal: space["4"], paddingTop: space["3"] },
  list: { padding: space["4"] },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space["2"] },
  grow: { flex: 1 },
  venueName: { fontSize: fontSize.xl, fontWeight: "700" },
  meta: { fontSize: fontSize.base, marginTop: 2 },
  pillCol: { alignItems: "flex-end", gap: space["1"] },
  moneyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: space["3"],
    paddingTop: space["3"],
    borderTopWidth: 1,
  },
});
