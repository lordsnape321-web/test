import { Picker } from "@react-native-picker/picker";
import Slider from "@react-native-community/slider";
import { useRouter } from "expo-router";
import {
  Banknote,
  HeartHandshake,
  MapPin,
  Search,
  SlidersHorizontal,
  Star,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VenueCard } from "@/components/cards";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { fetchVenues } from "@/api";
import { CITY_OPTIONS } from "@/lib/futsal";
import { validateSearch } from "@/lib/validation";
import type { Venue } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Courts near you — a 1:1 port of the web app's app/venues/page.tsx.
 *
 * Same header copy, same four filters (search, city, sort, price ceiling), same
 * city pill rail, same empty state. Filtering is client-side and uses the same
 * predicates and sort orders as the original so the two apps return the same
 * list for the same inputs.
 *
 * The web `<select>`s become @react-native-picker and the range input becomes
 * @react-native-community/slider, since RN has no native equivalent of either.
 */
export default function VenuesScreen() {
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [searchError, setSearchError] = useState("");

  const homeCity = (user as { defaultCity?: string } | null)?.defaultCity ?? "All Cities";
  const [city, setCity] = useState("All Cities");
  const [sort, setSort] = useState("rating");
  const [maxPrice, setMaxPrice] = useState(3000);

  // The web version seeds the city from the URL, then falls back to home city.
  useEffect(() => {
    if (homeCity && CITY_OPTIONS.includes(homeCity)) setCity(homeCity);
  }, [homeCity]);

  const load = useCallback(async () => {
    try {
      setVenues(await fetchVenues());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Identical predicate to the web version: an invalid search is treated as empty
  // rather than blocking the list.
  const safeQ = validateSearch(q, { max: 60 }) ? "" : q.trim();

  const filtered = useMemo(() => {
    let list = [...venues];
    if (safeQ) {
      const ql = safeQ.toLowerCase();
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(ql) ||
          v.address.toLowerCase().includes(ql) ||
          v.city.toLowerCase().includes(ql),
      );
    }
    if (city !== "All Cities") list = list.filter((v) => v.city === city);
    list = list.filter((v) => v.minPrice <= maxPrice);
    if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
    if (sort === "price-low") list.sort((a, b) => a.minPrice - b.minPrice);
    if (sort === "price-high") list.sort((a, b) => b.minPrice - a.minPrice);
    return list;
  }, [venues, safeQ, city, sort, maxPrice]);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        refreshing={refreshing}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.eyebrowRow}>
              <HeartHandshake size={14} color={colors.orange500} />
              <Text style={styles.eyebrow}>Pick your second home</Text>
            </View>
            <Text style={[styles.h1, { color: c.text }]}>Courts near you</Text>
            <Text style={[styles.subtitle, { color: c.textMuted }]}>
              {filtered.length} welcoming venues • honest prices • real people confirm your game
              {homeCity !== "All Cities" ? ` • 🏠 home: ${homeCity}` : ""}
            </Text>

            {/* Filters */}
            <View style={[styles.filterCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.field, { backgroundColor: c.inset }]}>
                <Search size={16} color={c.textFaint} />
                <TextInput
                  value={q}
                  onChangeText={(t) => {
                    setQ(t.slice(0, 60));
                    setSearchError(validateSearch(t, { max: 60 }) ?? "");
                  }}
                  placeholder="Try a neighbourhood or court name…"
                  placeholderTextColor={c.textFaint}
                  maxLength={60}
                  autoCorrect={false}
                  style={[styles.fieldInput, { color: c.text }]}
                />
              </View>

              <View style={styles.pickerRow}>
                <View style={[styles.field, styles.pickerField, { backgroundColor: c.inset }]}>
                  <MapPin size={16} color={c.textFaint} />
                  <Picker
                    selectedValue={city}
                    onValueChange={setCity}
                    style={[styles.picker, { color: c.text }]}
                    dropdownIconColor={c.textMuted}
                  >
                    {CITY_OPTIONS.map((opt) => (
                      <Picker.Item
                        key={opt}
                        label={opt === homeCity && opt !== "All Cities" ? `${opt} 🏠` : opt}
                        value={opt}
                      />
                    ))}
                  </Picker>
                </View>

                <View style={[styles.field, styles.pickerField, { backgroundColor: c.inset }]}>
                  <SlidersHorizontal size={16} color={c.textFaint} />
                  <Picker
                    selectedValue={sort}
                    onValueChange={setSort}
                    style={[styles.picker, { color: c.text }]}
                    dropdownIconColor={c.textMuted}
                  >
                    <Picker.Item label="Most loved" value="rating" />
                    <Picker.Item label="Price: low → high" value="price-low" />
                    <Picker.Item label="Price: high → low" value="price-high" />
                  </Picker>
                </View>
              </View>

              {searchError ? <Text style={styles.errorText}>{searchError}</Text> : null}

              {/* Price ceiling */}
              <View style={[styles.priceBox, { backgroundColor: c.inset }]}>
                <View style={styles.priceLabelRow}>
                  <Banknote size={16} color={colors.emerald600} />
                  <Text style={[styles.priceLabel, { color: c.textMuted }]}>
                    Up to Rs. {maxPrice.toLocaleString()}/hr
                  </Text>
                </View>
                <Slider
                  minimumValue={1000}
                  maximumValue={3000}
                  step={100}
                  value={maxPrice}
                  onValueChange={setMaxPrice}
                  minimumTrackTintColor={colors.emerald600}
                  maximumTrackTintColor={c.border}
                  thumbTintColor={colors.emerald600}
                  accessibilityLabel={`Maximum price per hour, currently Rs. ${maxPrice.toLocaleString()}`}
                />
              </View>
            </View>

            {/* City pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.pillRail}
              contentContainerStyle={styles.pillRailContent}
            >
              {CITY_OPTIONS.map((opt) => {
                const active = city === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setCity(opt)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.pill,
                      active
                        ? { backgroundColor: colors.emerald600 }
                        : { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 },
                    ]}
                  >
                    <Text
                      style={[styles.pillText, { color: active ? "#FFFFFF" : c.textMuted }]}
                    >
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={[styles.empty, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Star size={40} color={c.textFaint} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>Hmm, nothing found</Text>
              <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                Try a different area or stretch the budget a little — your perfect court is out
                there!
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <VenueCard v={item} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { padding: space[4], paddingBottom: space[10] },

  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.6,
    color: colors.orange500,
  },
  h1: { fontSize: fontSize["4xl"], fontWeight: "900", marginTop: 4 },
  subtitle: { fontSize: fontSize.base, color: colors.stone500, marginTop: 4 },

  filterCard: {
    marginTop: space[5],
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[3],
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    minHeight: 48,
  },
  fieldInput: { flex: 1, fontSize: fontSize.base, fontWeight: "600", paddingVertical: 0 },
  pickerRow: { flexDirection: "row", gap: space[2], marginTop: space[2] },
  pickerField: { flex: 1, paddingRight: 0 },
  picker: { flex: 1, marginLeft: -space[2], height: 44 },

  errorText: { marginTop: 6, fontSize: fontSize.xs, fontWeight: "700", color: colors.red500 },

  priceBox: {
    marginTop: space[2],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: 10,
  },
  priceLabelRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  priceLabel: { fontSize: fontSize.sm, fontWeight: "700" },

  pillRail: { flexGrow: 0, marginTop: space[4] },
  pillRailContent: { gap: space[2], paddingRight: space[4] },
  pill: {
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: 36,
    justifyContent: "center",
  },
  pillText: { fontSize: fontSize.sm, fontWeight: "900" },

  empty: {
    marginTop: space[10],
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[12],
    alignItems: "center",
  },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: "800", marginTop: space[3] },
  emptyBody: {
    fontSize: fontSize.base,
    color: colors.stone500,
    marginTop: 4,
    textAlign: "center",
  },
});
