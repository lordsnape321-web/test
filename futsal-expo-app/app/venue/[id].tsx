import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Notice, Pill, Spinner } from "@/components/ui";
import { createBooking, fetchAvailability, fetchCourts, fetchVenue } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import {
  addHours,
  expandBookingSlots,
  formatNPR,
  next7Days,
  prettyDayShort,
  timeSlots,
  todayISO,
} from "@/lib/futsal";
import type { Court, Venue } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";

/**
 * Venue detail → pick a court, a day and a slot → create the booking.
 *
 * Slot availability is fetched per court/day and the taken slots are disabled in
 * the grid, so a player cannot submit a booking that the server would reject
 * with 409. The server still validates; this is just not wasting their tap.
 *
 * All the date and time arithmetic comes from the ported src/lib/futsal.ts —
 * the same module the web app uses — so a slot that is valid here is valid
 * there.
 */
export default function VenueDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const venueId = Number(id);
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [venue, setVenue] = useState<Venue | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [courtId, setCourtId] = useState<number | null>(null);
  const [date, setDate] = useState<string>(todayISO());
  const [start, setStart] = useState<string | null>(null);
  const [hours, setHours] = useState(1);
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Load the venue and its courts once. */
  useEffect(() => {
    if (!Number.isFinite(venueId)) return;
    (async () => {
      setLoading(true);
      try {
        setError(null);
        const [v, c] = await Promise.all([fetchVenue(venueId), fetchCourts(venueId)]);
        setVenue(v);
        setCourts(c);
        setCourtId(c[0]?.id ?? null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not load this venue.");
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId]);

  /* Re-check availability whenever the court or day changes. */
  useEffect(() => {
    if (!courtId) return;
    (async () => {
      try {
        const { booked } = await fetchAvailability(courtId, date);
        setBookedSlots(new Set(booked));
      } catch {
        // Non-fatal: the server still rejects double bookings on submit.
        setBookedSlots(new Set());
      }
    })();
  }, [courtId, date]);

  const court = useMemo(() => courts.find((c) => c.id === courtId) ?? null, [courts, courtId]);
  const days = useMemo(() => next7Days(), []);

  const slots = useMemo(() => {
    if (!venue) return [];
    return timeSlots(venue.openingHour, venue.closingHour);
  }, [venue]);

  /** A slot is bookable only if every hour it spans is free. */
  const isSlotFree = useCallback(
    (slot: string) => {
      const spans = expandBookingSlots(slot, hours);
      return spans.every((s) => !bookedSlots.has(s));
    },
    [bookedSlots, hours],
  );

  const endTime = start ? addHours(start, hours) : null;
  const pricePerHour = court?.pricePerHour ?? 0;
  const total = pricePerHour * hours;

  async function book() {
    if (!courtId || !start || !user) return;
    setBusy(true);
    setError(null);
    try {
      const { booking } = await createBooking({
        courtId,
        userId: user.id,
        date,
        startTime: start,
        durationHours: hours,
        bookerName: user.name,
        bookerPhone: user.phone,
        paymentMethod: "eSewa",
      });
      router.push(`/booking/${booking.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not create the booking. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading venue…" />;

  if (!venue) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
        <View style={styles.pad}>
          <Notice message={error ?? "Venue not found."} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.name, { color: colors.text }]}>{venue.name}</Text>
        <Text style={[styles.address, { color: colors.textMuted }]}>
          {venue.address} · {venue.city}
        </Text>
        <Text style={[styles.desc, { color: colors.textMuted }]}>{venue.description}</Text>

        {error ? <Notice message={error} /> : null}

        {/* ── court picker ─────────────────────────────────────────── */}
        <SectionTitle>Court</SectionTitle>
        {courts.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
            This venue has no active courts right now.
          </Text>
        ) : (
          <View style={styles.chipRow}>
            {courts.map((c) => {
              const active = c.id === courtId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setCourtId(c.id);
                    setStart(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.chip,
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
                    }}
                  >
                    {c.name}
                  </Text>
                  <Text
                    style={{
                      color: active ? colors.primaryText : colors.textMuted,
                      fontSize: fontSize.xs,
                    }}
                  >
                    {formatNPR(c.pricePerHour)}/hr
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* ── day picker ───────────────────────────────────────────── */}
        <SectionTitle>Day</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayRow}>
          {days.map((d) => {
            const active = d === date;
            return (
              <Pressable
                key={d}
                onPress={() => {
                  setDate(d);
                  setStart(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.dayChip,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                {(() => {
                  // prettyDayShort returns { dow, day, month }, not a string.
                  const p = prettyDayShort(d);
                  return (
                    <>
                      <Text
                        style={{
                          color: active ? colors.primaryText : colors.textMuted,
                          fontSize: fontSize.xs,
                          textAlign: "center",
                        }}
                      >
                        {p.dow}
                      </Text>
                      <Text
                        style={{
                          color: active ? colors.primaryText : colors.text,
                          fontSize: fontSize.base,
                          fontWeight: "700",
                          textAlign: "center",
                        }}
                      >
                        {p.day}
                      </Text>
                      <Text
                        style={{
                          color: active ? colors.primaryText : colors.textMuted,
                          fontSize: fontSize.xs,
                          textAlign: "center",
                        }}
                      >
                        {p.month}
                      </Text>
                    </>
                  );
                })()}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── duration ─────────────────────────────────────────────── */}
        <SectionTitle>Duration</SectionTitle>
        <View style={styles.chipRow}>
          {[1, 2, 3].map((h) => {
            const active = h === hours;
            return (
              <Pressable
                key={h}
                onPress={() => {
                  setHours(h);
                  setStart(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
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
                  }}
                >
                  {h} hr{h > 1 ? "s" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── slot grid ────────────────────────────────────────────── */}
        <SectionTitle>Start time</SectionTitle>
        <View style={styles.slotGrid}>
          {slots.map((slot) => {
            const free = isSlotFree(slot);
            const active = slot === start;
            return (
              <Pressable
                key={slot}
                onPress={() => free && setStart(slot)}
                disabled={!free}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: !free }}
                style={[
                  styles.slot,
                  {
                    backgroundColor: !free
                      ? colors.surfaceAlt
                      : active
                        ? colors.primary
                        : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                    opacity: free ? 1 : 0.5,
                  },
                ]}
              >
                <Text
                  style={{
                    color: !free
                      ? colors.textFaint
                      : active
                        ? colors.primaryText
                        : colors.text,
                    fontSize: fontSize.sm,
                    fontWeight: "600",
                  }}
                >
                  {slot}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── summary + submit ─────────────────────────────────────── */}
        <Card style={{ marginTop: space.xl }}>
          <SummaryRow label="Court" value={court?.name ?? "—"} colors={colors} />
          <SummaryRow label="Date" value={date} colors={colors} />
          <SummaryRow
            label="Time"
            value={start && endTime ? `${start} – ${endTime}` : "Pick a slot"}
            colors={colors}
          />
          <SummaryRow
            label="Rate"
            value={`${formatNPR(pricePerHour)} × ${hours} hr`}
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SummaryRow label="Total" value={formatNPR(total)} colors={colors} strong />
        </Card>

        <Button
          label={start ? `Book for ${formatNPR(total)}` : "Pick a start time"}
          onPress={book}
          loading={busy}
          disabled={!start || !courtId}
        />
        <Text style={[styles.hint, { color: colors.textFaint }]}>
          You can pay on the next screen with eSewa or Khalti.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.section, { color: colors.text }]}>{children}</Text>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  colors,
}: {
  label: string;
  value: string;
  strong?: boolean;
  colors: { text: string; textMuted: string };
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{label}</Text>
      <Text
        style={{
          color: colors.text,
          fontSize: strong ? fontSize.lg : fontSize.sm,
          fontWeight: strong ? "700" : "500",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space.lg, paddingBottom: space.xxxl },
  pad: { padding: space.lg },
  name: { fontSize: fontSize.xl, fontWeight: "700" },
  address: { fontSize: fontSize.sm, marginTop: 2 },
  desc: { fontSize: fontSize.sm, marginTop: space.md, marginBottom: space.lg, lineHeight: 20 },
  section: { fontSize: fontSize.base, fontWeight: "700", marginTop: space.xl, marginBottom: space.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  dayRow: { flexGrow: 0, marginBottom: space.sm },
  dayChip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginRight: space.sm,
    minWidth: 64,
    minHeight: 44,
    justifyContent: "center",
  },
  slotGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  slot: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minWidth: 72,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.xs,
  },
  divider: { height: 1, marginVertical: space.sm },
  hint: { fontSize: fontSize.xs, textAlign: "center", marginTop: space.md },
});
