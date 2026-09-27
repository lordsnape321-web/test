import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

/**
 * Leagues moved 🏆
 *
 * The listing now lives inside Matches, as the "League matches" half of the
 * open-games / league-matches toggle. Leagues are matches with a table attached,
 * and giving them their own top-level tab was one destination too many — on a
 * phone the bottom rail had already run out of room for it.
 *
 * This route stays as a redirect rather than being deleted, so every existing
 * bookmark, seeded notification link and shared URL lands somewhere sensible
 * instead of dead-ending. The league *detail* route (`/leagues/[id]`) is
 * untouched — that is still where a host runs the competition.
 *
 * (Web: `redirect("/matches?tab=leagues")` — native carries the tab as a param
 * the matches screen seeds its state from.)
 */
export default function LeaguesIndex() {
  const { colors: c, isDark } = useTheme();
  const { user, ready } = useAuth();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#020617" : "#F1F5F9" }}>
        <ActivityIndicator size="large" color={c.textFaint} />
      </View>
    );
  }

  if (user?.role === "owner") return <Redirect href="/admin/leagues" />;
  return <Redirect href={{ pathname: "/(app)/matches", params: { tab: "leagues" } }} />;
}
