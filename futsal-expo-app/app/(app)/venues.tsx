import Slider from "@react-native-community/slider";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { Notice } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { fetchVenues } from "@/api";
import { demoSeedError, ensureDemoSeed } from "@/lib/demo-seed";
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
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const { q: qParam, city: cityParam } = useLocalSearchParams<{ q?: string; city?: string }>();
  const router = useRouter();
  const bp = useBreakpoints();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState(qParam ?? "");
  const [searchError, setSearchError] = useState("");
  const [loadError, setLoadError] = useState("");

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

  // The Courts tab stays mounted once it has been visited, so a `useState`
  // initialiser only ever sees the params of the *first* mount. Without these
  // two effects, searching from the landing page while the tab is already warm
  // just changed tabs and silently kept the old query — the user landed on the
  // right screen with the wrong list and had to type it again. Same pattern the
  // Matches screen uses for its `?tab=` deep link.
  useEffect(() => {
    setQ(qParam ?? "");
    setSearchError("");
  }, [qParam]);

  useEffect(() => {
    // Absent or unrecognised city: leave the field alone so the home-city
    // fallback below still applies. Only a real choice marks it as touched.
    if (!cityParam || !CITY_OPTIONS.includes(cityParam)) return;
    setCity(cityParam);
    setCityTouched(true);
  }, [cityParam]);

  /**
   * Clearing has to take the route param with it, not just the visible text.
   * Leaving `?q=chabahil` in the URL while the box reads empty is what made
   * "clear, then search the same thing again" silently do nothing: the next
   * search pushed byte-identical params, so `qParam` never changed, the sync
   * effect above never re-fired, and the list stayed unfiltered.
   */
  const clearSearch = useCallback(() => {
    setQ("");
    setSearchError("");
    router.setParams({ q: undefined, city: undefined });
    setCityTouched(false);
  }, [router]);

  // The web version seeds the city from the URL, then falls back to home city.
  useEffect(() => {
    if (!cityTouched && homeCity && CITY_OPTIONS.includes(homeCity)) setCity(homeCity);
  }, [cityTouched, homeCity]);

  const load = useCallback(async () => {
    // The idempotent demo seed runs at most once a session and never blocks a
    // read: a database with venues in it should not wait for a seeding attempt
    // that is going to answer "already present".
    void ensureDemoSeed();

    try {
      let next = await fetchVenues();

      if (next.length === 0 && (await ensureDemoSeed())) {
        next = await fetchVenues();
      }

      setVenues(next);
      const seedError = demoSeedError();
      setLoadError(
        next.length === 0 && seedError
          ? seedError instanceof Error
            ? seedError.message
            : "The Laravel API could not seed or read venue data."
          : "",
      );
    } catch (error) {
      setVenues([]);
      setLoadError(error instanceof Error ? error.message : "Could not load venues from Laravel.");
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
          { width: "100%", paddingHorizontal: bp.gutter },
        ]}
        ListHeaderComponent={
          <>
            {loadError ? <Notice message={loadError} /> : null}
            <View style={styles.eyebrowRow}>
              <HeartHandshake size={14} color={colors.orange500} />
              <Text style={[styles.eyebrow, { color: c.accent }]}>Pick your second home</Text>
            </View>
            <Text style={[styles.h1, { color: c.text }]}>
              {safeQ ? "Search results" : "Courts near you"}
            </Text>
            {/* Say out loud what the list is actually filtered by. Arriving from
                the landing page search used to look identical to opening the tab,
                which is why it read as "it just changed the tab". */}
            {safeQ ? (
              <View style={styles.resultRow}>
                <Text style={[styles.resultText, { color: c.textMuted }]} numberOfLines={2}>
                  {filtered.length === 0
                    ? `No court matches “${safeQ}”`
                    : `${filtered.length} ${filtered.length === 1 ? "court" : "courts"} matching “${safeQ}”`}
                  {city !== "All Cities" ? ` in ${city}` : ""}
                </Text>
                <Pressable
                  onPress={clearSearch}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  style={({ pressed }) => [styles.clearBtn, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={[styles.clearText, { color: c.textMuted }]}>Clear</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[styles.subtitle, { color: c.textMuted }]}>
                {filtered.length} welcoming venues • honest prices • real people confirm your game
                {homeCity !== "All Cities" ? ` • 🏠 home: ${homeCity}` : ""}
              </Text>
            )}

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
                />
              </View>

              {searchError ? <Text style={[styles.errorText, { color: c.dangerText }]}>{searchError}</Text> : null}

              {/* Price ceiling */}
              <View style={[styles.priceBox, { backgroundColor: c.inset }]}>
                <View style={styles.priceLabelRow}>
                  <Banknote size={16} color={c.primary} />
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
                  minimumTrackTintColor={c.primary}
                  maximumTrackTintColor={c.border}
                  thumbTintColor={c.primary}
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
                          ? { backgroundColor: c.primary }
                          : { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 },
                      ]}
                    >
                      <Text
                        style={[styles.pillText, { color: active ? c.primaryText : c.textMuted }]}
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
}: {
  label: string;
  icon: typeof MapPin;
  value: string;
  options: readonly SelectOption[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
  colors: { inset: string; text: string; textMuted: string; textFaint: string; border: string; surface: string; activeSoft: string; activeText: string; primary: string; primaryText: string; scrim: string; shadow: string; dangerText: string };
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
        <Pressable style={[styles.modalBackdrop, { backgroundColor: c.scrim }]} onPress={onClose}>
          <View
            style={[styles.optionSheet, { backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow }]}
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
                      <Text style={[styles.optionCheck, { color: c.activeText }]}>✓</Text>
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

  resultRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  resultText: { flex: 1, fontSize: fontSize.base, lineHeight: 21 },
  clearBtn: {
    paddingHorizontal: space[3],
    paddingVertical: 6,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.stone300,
  },
  clearText: { fontSize: fontSize.sm, fontWeight: "800" },

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
