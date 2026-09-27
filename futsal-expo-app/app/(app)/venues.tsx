import Slider from "@react-native-community/slider";
import { useLocalSearchParams } from "expo-router";
import {
  Banknote,
  ChevronDown,
  HeartHandshake,
  MapPin,
  Search,
  SlidersHorizontal,
  Star,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
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
import { useBreakpoints } from "@/lib/responsive";
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
 * The web `<select>`s become themed modal menus so every city and sort option
 * stays readable on narrow screens and in dark mode. The range input becomes
 * @react-native-community/slider, since RN has no native equivalent.
 */
type OpenSelect = "city" | "sort" | null;

type SelectOption = {
  value: string;
  label: string;
};

export default function VenuesScreen() {
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();
  const { q: qParam, city: cityParam } = useLocalSearchParams<{ q?: string; city?: string }>();
  const bp = useBreakpoints();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState(qParam ?? "");
  const [searchError, setSearchError] = useState("");

  const homeCity = user?.defaultCity ?? "All Cities";
  const initialCity = cityParam && CITY_OPTIONS.includes(cityParam) ? cityParam : "All Cities";
  const [city, setCity] = useState(initialCity);
  const [cityTouched, setCityTouched] = useState(Boolean(cityParam));
  const [sort, setSort] = useState("rating");
  const [maxPrice, setMaxPrice] = useState(3000);
  const [openSelect, setOpenSelect] = useState<OpenSelect>(null);

  const cityOptions: SelectOption[] = CITY_OPTIONS.map((option) => ({
    value: option,
    label: option === homeCity && option !== "All Cities" ? `${option} 🏠` : option,
  }));
  const sortOptions: SelectOption[] = [
    { value: "rating", label: "Most loved" },
    { value: "price-low", label: "Price: low → high" },
    { value: "price-high", label: "Price: high → low" },
  ];

  // The web version seeds the city from the URL, then falls back to home city.
  useEffect(() => {
    if (!cityTouched && homeCity && CITY_OPTIONS.includes(homeCity)) setCity(homeCity);
  }, [cityTouched, homeCity]);

  const load = useCallback(async () => {
    try {
      setVenues(await fetchVenues());
    } catch {
      // Keep the filters and empty state usable while the API is offline.
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

  const cols = bp.cardColumns;
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <FlatList
        // Remount when column count changes — FlatList forbids changing numColumns live.
        key={`cols-${cols}`}
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? { gap: space[4] } : undefined}
        ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
        refreshing={refreshing}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
        }
        contentContainerStyle={[
          styles.listContent,
          {
            maxWidth: bp.contentMax,
            width: "100%",
            alignSelf: "center",
            paddingHorizontal: bp.gutter,
          },
        ]}
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

              <View style={[styles.pickerRow, bp.sm ? styles.pickerRowWide : null]}>
                <FilterSelect
                  label="City"
                  icon={MapPin}
                  value={city}
                  options={cityOptions}
                  open={openSelect === "city"}
                  onOpen={() => setOpenSelect("city")}
                  onClose={() => setOpenSelect(null)}
                  onChange={(next) => {
                    setCity(next);
                    setCityTouched(true);
                  }}
                  colors={c}
                  isDark={isDark}
                />
                <FilterSelect
                  label="Sort courts"
                  icon={SlidersHorizontal}
                  value={sort}
                  options={sortOptions}
                  open={openSelect === "sort"}
                  onOpen={() => setOpenSelect("sort")}
                  onClose={() => setOpenSelect(null)}
                  onChange={setSort}
                  colors={c}
                  isDark={isDark}
                />
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
            <View style={styles.citySection}>
              <Text style={[styles.citySectionLabel, { color: c.textFaint }]}>Browse by city</Text>
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
                      onPress={() => {
                        setCity(opt);
                        setCityTouched(true);
                      }}
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
            </View>
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
        renderItem={({ item }) => (
          <View style={{ flex: cols > 1 ? 1 : undefined, minWidth: 0 }}>
            <VenueCard v={item} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function FilterSelect({
  label,
  icon: Icon,
  value,
  options,
  open,
  onOpen,
  onClose,
  onChange,
  colors: c,
  isDark,
}: {
  label: string;
  icon: typeof MapPin;
  value: string;
  options: readonly SelectOption[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
  colors: { inset: string; text: string; textMuted: string; textFaint: string; border: string; surface: string; activeSoft: string };
  isDark: boolean;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const handleChange = (next: string) => {
    onChange(next);
    onClose();
  };

  return (
    <>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        style={[styles.field, styles.pickerField, styles.selectButton, { backgroundColor: c.inset }]}
      >
        <Icon size={16} color={c.textFaint} />
        <Text style={[styles.selectValue, { color: c.text }]}>{selected?.label ?? "Select"}</Text>
        <ChevronDown size={17} color={c.textMuted} style={styles.selectChevron} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <Pressable style={styles.modalBackdrop} onPress={onClose}>
          <View
            style={[styles.optionSheet, { backgroundColor: c.surface, borderColor: c.border }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.optionHeader, { borderBottomColor: c.border }]}>
              <Text style={[styles.optionHeaderText, { color: c.text }]}>{label}</Text>
              <Pressable onPress={onClose} accessibilityLabel={`Close ${label} menu`} hitSlop={8}>
                <Text style={{ color: c.textMuted, fontSize: 24, lineHeight: 24 }}>×</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.optionList} contentContainerStyle={{ paddingBottom: space[2] }}>
              {options.map((option) => {
                const selectedOption = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => handleChange(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedOption }}
                    style={[
                      styles.option,
                      { borderBottomColor: c.border },
                      selectedOption ? { backgroundColor: c.activeSoft } : null,
                    ]}
                  >
                    <Text style={[styles.optionText, { color: c.text }]}>{option.label}</Text>
                    {selectedOption ? (
                      <Text style={[styles.optionCheck, { color: isDark ? colors.emerald300 : colors.emerald700 }]}>✓</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { padding: space[4], paddingBottom: space[10] },
  itemSeparator: { height: space[4] },

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
  pickerRow: { flexDirection: "column", gap: space[2], marginTop: space[2] },
  pickerRowWide: { flexDirection: "row" },
  pickerField: { flex: 1, width: "100%", minWidth: 0 },
  selectButton: {
    minHeight: 50,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
  },
  selectValue: { flex: 1, minWidth: 0, color: colors.stone900, fontSize: fontSize.base, fontWeight: "700" },
  selectChevron: { flexShrink: 0 },

  errorText: { marginTop: 6, fontSize: fontSize.xs, fontWeight: "700", color: colors.red500 },

  priceBox: {
    marginTop: space[2],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: 10,
  },
  priceLabelRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  priceLabel: { fontSize: fontSize.sm, fontWeight: "700" },

  citySection: { width: "100%", marginTop: space[4], marginBottom: space[2] },
  citySectionLabel: { fontSize: fontSize.xs, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: space[2] },
  pillRail: { width: "100%", flexGrow: 0 },
  pillRailContent: { gap: space[2], paddingRight: space[4], paddingVertical: 2, alignItems: "center" },
  pill: {
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: 38,
    justifyContent: "center",
  },
  pillText: { fontSize: fontSize.sm, fontWeight: "900" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.68)",
    alignItems: "center",
    justifyContent: "center",
    padding: space[4],
  },
  optionSheet: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "82%",
    borderWidth: 1,
    borderRadius: radius["3xl"],
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  optionHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[5],
    borderBottomWidth: 1,
  },
  optionHeaderText: { flex: 1, fontSize: fontSize.lg, fontWeight: "900" },
  optionList: { flexGrow: 0 },
  option: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { flex: 1, minWidth: 0, fontSize: fontSize.base, fontWeight: "700" },
  optionCheck: { fontSize: fontSize.lg, fontWeight: "900" },

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
