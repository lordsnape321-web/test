import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Empty, Notice, Pill, Spinner } from "@/components/ui";
import { useTheme } from "@/context/ThemeContext";
import { fetchVenues } from "@/api";
import { formatNPR } from "@/lib/futsal";
import type { Venue } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";

/**
 * Venue list — the landing screen after sign-in.
 *
 * Search filters client-side. The route does support `?q=`, but the full list is
 * small enough that filtering locally keeps typing instant and avoids a request
 * per keystroke. Swapping to server-side search later is a one-line change in
 * the useEffect dependency list.
 */
export default function VenuesScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await fetchVenues();
      setVenues(list);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not load venues. ${e.message}`
          : "Could not load venues. Check that the API is reachable.",
      );
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.address.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q),
    );
  }, [venues, query]);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]} edges={["top"]}>
      <View style={[styles.searchWrap, { backgroundColor: colors.surface }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, area or city"
          placeholderTextColor={colors.textFaint}
          autoCorrect={false}
          accessibilityLabel="Search venues"
          style={[
            styles.searchInput,
            {
              backgroundColor: colors.inset,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />
      </View>

      {error ? (
        <View style={styles.noticeWrap}>
          <Notice message={error} />
        </View>
      ) : null}

      {loading ? (
        <Spinner label="Loading venues…" />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <Empty
              message={query ? `No venues match "${query}"` : "No venues yet — check back soon."}
            />
          }
          renderItem={({ item }) => (
            <VenueCard venue={item} onPress={() => router.push(`/venue/${item.id}`)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function VenueCard({ venue, onPress }: { venue: Venue; onPress: () => void }) {
  const { colors } = useTheme();
  const rating = Number(venue.rating ?? 0);

  return (
    <Card onPress={onPress}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={[styles.venueName, { color: colors.text }]} numberOfLines={1}>
            {venue.name}
          </Text>
          <Text style={[styles.venueMeta, { color: colors.textMuted }]} numberOfLines={1}>
            {venue.address}
          </Text>
        </View>
        {venue.isFeatured ? <Pill label="Featured" tone="brand" /> : null}
      </View>

      <View style={[styles.statRow, { marginTop: space["3"] }]}>
        <Pill label={`★ ${rating.toFixed(1)} (${venue.totalReviews})`} tone="warning" />
        <Pill label={`${venue.courtCount} court${venue.courtCount === 1 ? "" : "s"}`} />
        <Pill label={`from ${formatNPR(venue.minPrice)}/hr`} tone="success" />
      </View>

      <Text style={[styles.hours, { color: colors.textFaint }]}>
        Open {venue.openingHour}:00 – {venue.closingHour}:00 · {venue.city}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchWrap: { paddingHorizontal: space["4"], paddingVertical: space["3"] },
  searchInput: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space["3"],
    minHeight: 44,
    fontSize: fontSize.lg,
  },
  noticeWrap: { paddingHorizontal: space["4"], paddingTop: space["2"] },
  list: { padding: space["4"], paddingTop: space["2"] },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space["2"] },
  grow: { flex: 1 },
  venueName: { fontSize: fontSize.xl, fontWeight: "700" },
  venueMeta: { fontSize: fontSize.base, marginTop: 2 },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: space["2"] },
  hours: { fontSize: fontSize.sm, marginTop: space["3"] },
});
