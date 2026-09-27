import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fontSize } from "@/theme";

type BookingVenueNameProps = {
  name?: string | null;
  color: string;
};

/**
 * One consistent venue-name treatment for the player booking list and detail
 * screen. The name gets the full available width and wraps naturally, so it is
 * never ellipsized, hidden in a marquee, or squeezed differently by payment
 * status.
 */
export function BookingVenueName({ name, color }: BookingVenueNameProps) {
  return (
    <View style={styles.rail} accessibilityLabel={name ?? "Venue"}>
      <Text style={[styles.text, { color }]}>{name?.trim() || "Venue"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: "100%", minHeight: 44, justifyContent: "center" },
  text: { fontSize: fontSize.lg, lineHeight: 22, fontWeight: "800", flexShrink: 1 },
});
