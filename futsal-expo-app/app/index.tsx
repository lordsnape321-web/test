import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

/**
 * Entry point. Sends the user to the venue list or the sign-in screen.
 *
 * The `ready` gate is what stops a returning user from seeing the login screen
 * flash on every cold start: AsyncStorage has to be read before we know whether
 * a session exists, and that read is asynchronous.
 */
export default function Index() {
  const { user, ready } = useAuth();
  const { colors } = useTheme();

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Redirect href={user ? "/(app)" : "/login"} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
