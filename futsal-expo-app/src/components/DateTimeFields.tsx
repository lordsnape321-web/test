import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { formatTime12, prettyDayShort, timeSlots, todayISO } from "@/lib/futsal";
import { fontSize, radius, space } from "@/theme";

/**
 * DateField and TimeField — the native stand-ins for `<input type="date">` /
 * `<input type="time">`, the same chip pickers the booking and create-game
 * flows already use (see matches.tsx's note: RN has no native date input here,
 * so day and time are chip strips).
 *
 * The strip spans `daysBack`…`daysForward` around today and always folds the
 * current `value` in if it falls outside that window, so editing an old
 * fixture still shows its date selected. `allowClear` adds a leading "TBC"
 * chip for optional dates — the web leaves the input empty, we set "".
 */

export function DateField({
  label,
  value,
  onChange,
  allowClear = false,
  daysBack = 30,
  daysForward = 150,
}: {
  label: string;
  /** ISO yyyy-mm-dd, or "" when clear. */
  value: string;
  onChange: (iso: string) => void;
  /** Offer a leading "TBC" chip that clears the value (optional dates). */
  allowClear?: boolean;
  daysBack?: number;
  daysForward?: number;
}) {
  const { colors: c } = useTheme();

  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = -daysBack; i <= daysForward; i++) out.push(todayISO(i));
    if (value && !out.includes(value)) out.push(value);
    out.sort();
    return out;
  }, [daysBack, daysForward, value]);

  return (
    <View style={styles.block}>
      <Text style={[styles.label, { color: c.textFaint }]}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {allowClear ? (
          <Pressable
            onPress={() => onChange("")}
            accessibilityRole="button"
            accessibilityState={{ selected: value === "" }}
            style={[
              styles.chip,
              {
                backgroundColor: value === "" ? c.primary : c.inset,
                borderColor: value === "" ? c.primary : c.border,
              },
            ]}
          >
            <Text
              style={[styles.chipTop, { color: value === "" ? c.primaryText : c.textFaint }]}
            >
              TBC
            </Text>
            <Text
              style={[styles.chipBottom, { color: value === "" ? c.primaryText : c.textMuted }]}
            >
              no date
            </Text>
          </Pressable>
        ) : null}
        {days.map((iso) => {
          const on = iso === value;
          const p = prettyDayShort(iso);
          return (
            <Pressable
              key={iso}
              onPress={() => onChange(iso)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? c.primary : c.inset,
                  borderColor: on ? c.primary : c.border,
                },
              ]}
            >
              <Text style={[styles.chipTop, { color: on ? c.primaryText : c.textFaint }]}>
                {p.dow}
              </Text>
              <Text style={[styles.chipBottom, { color: on ? c.primaryText : c.textMuted }]}>
                {p.day} {p.month}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function TimeField({
  label,
  value,
  onChange,
  allowClear = false,
}: {
  label: string;
  /** 24h "HH:MM", or "" when clear. */
  value: string;
  onChange: (time: string) => void;
  allowClear?: boolean;
}) {
  const { colors: c } = useTheme();

  const slots = useMemo(() => {
    const out = timeSlots(6, 23);
    if (value && !out.includes(value)) out.push(value);
    return out;
  }, [value]);

  return (
    <View style={styles.block}>
      <Text style={[styles.label, { color: c.textFaint }]}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {allowClear ? (
          <Pressable
            onPress={() => onChange("")}
            accessibilityRole="button"
            accessibilityState={{ selected: value === "" }}
            style={[
              styles.timeChip,
              {
                backgroundColor: value === "" ? c.primary : c.inset,
                borderColor: value === "" ? c.primary : c.border,
              },
            ]}
          >
            <Text
              style={[styles.timeChipText, { color: value === "" ? c.primaryText : c.textMuted }]}
            >
              TBC
            </Text>
          </Pressable>
        ) : null}
        {slots.map((t) => {
          const on = t === value;
          return (
            <Pressable
              key={t}
              onPress={() => onChange(t)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.timeChip,
                {
                  backgroundColor: on ? c.primary : c.inset,
                  borderColor: on ? c.primary : c.border,
                },
              ]}
            >
              <Text style={[styles.timeChipText, { color: on ? c.primaryText : c.textMuted }]}>
                {formatTime12(t)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space["2"] },
  label: {
    fontSize: fontSize.xs,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  rail: { gap: space["2"], paddingRight: space["2"] },
  chip: {
    minWidth: 64,
    paddingHorizontal: space["3"],
    paddingVertical: space["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
  },
  chipTop: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  chipBottom: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 1 },
  timeChip: {
    paddingHorizontal: space["3"],
    paddingVertical: space["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  timeChipText: { fontSize: fontSize.xs, fontWeight: "800" },
});
