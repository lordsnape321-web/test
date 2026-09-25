import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { fontSize } from "@/theme";

type BookingVenueNameProps = {
  name?: string | null;
  color: string;
};

/**
 * One consistent venue-name treatment for the player booking list and detail
 * screen. The name stays on one line at its natural size; a long venue name is
 * horizontally scrollable rather than ellipsized or squeezed into a different
 * font size in each screen.
 */
export function BookingVenueName({ name, color }: BookingVenueNameProps) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.rail}
      contentContainerStyle={styles.content}
      accessibilityLabel={name ?? "Venue"}
    >
      <Text style={[styles.text, { color }]}>{name?.trim() || "Venue"}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { width: "100%", flexShrink: 1 },
  content: { flexDirection: "row", alignItems: "center" },
  text: { fontSize: fontSize.lg, lineHeight: 22, fontWeight: "800", flexShrink: 0 },
});
