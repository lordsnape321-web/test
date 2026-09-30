import { Tabs } from "expo-router";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { OwnerGuard } from "@/components/OwnerGuard";
import { OwnerHeader, OwnerSidebar, OwnerTabBar } from "@/components/OwnerShell";
import { useTheme } from "@/context/ThemeContext";
import { useBreakpoints } from "@/lib/responsive";
import { space } from "@/theme";

/** The workspace column: Owner Studio's own cap, not the player page's. */
const contentMax = 1440;

/**
 * Owner Studio layout — brand bar + the six-item owner rail, with every child
 * gated by OwnerGuard (loading → sign-in → owners-only → content).
 *
 * Entering here selects the slate Owner Studio palette while preserving the
 * global light/dark mode, matching the web OwnerShell without the warm player
 * clubhouse colours.
 */
export default function AdminLayout() {
  const { colors: c, setStudio } = useTheme();
  const { lg } = useBreakpoints();
  // Below `lg` the rail collapses into a tab bar and each screen keeps the phone
  // padding it was designed with; from `lg` up the workspace becomes a centred
  // card column, aligned with the brand bar's own gutter.
  const gutter = space[6];

  useEffect(() => {
    setStudio(true);
    return () => setStudio(false);
  }, [setStudio]);

  return (
    <OwnerGuard>
      <View style={[styles.flex, { backgroundColor: c.bg }]}>
        <OwnerHeader />
        <View
          style={[
            styles.body,
            lg
              ? [styles.bodyWide, { maxWidth: contentMax, paddingHorizontal: gutter, gap: gutter }]
              : null,
          ]}
        >
          {lg ? <OwnerSidebar /> : null}
          <View style={[styles.content, { backgroundColor: c.bg }]}>
            <Tabs
              screenOptions={{
                headerShown: false,
                // Both keys matter across React Navigation versions: the scene
                // wrapper and the navigator content must inherit Owner Studio's
                // slate background instead of the platform default white.
                sceneStyle: { backgroundColor: c.bg },
              }}
              tabBar={
                lg
                  ? () => null
                  : (props) => (
                      <OwnerTabBar
                        state={props.state}
                        descriptors={props.descriptors as never}
                        navigation={
                          props.navigation as unknown as {
                            emit: (e: unknown) => boolean;
                            navigate: (name: string) => void;
                          }
                        }
                      />
                    )
              }
            >
              <Tabs.Screen name="index" options={{ title: "Home" }} />
              <Tabs.Screen name="requests" options={{ title: "Requests" }} />
              <Tabs.Screen name="bookings" options={{ title: "Bookings" }} />
              <Tabs.Screen name="venues" options={{ title: "Venues" }} />
              <Tabs.Screen name="leagues" options={{ title: "Leagues" }} />
              <Tabs.Screen name="notifications" options={{ title: "Alerts" }} />
              {/* Profile and league detail sit outside the rail but remain owner screens. */}
              <Tabs.Screen name="profile" options={{ title: "Profile", href: null }} />
              <Tabs.Screen name="leagues/[id]" options={{ title: "League control", href: null }} />
            </Tabs>
          </View>
        </View>
      </View>
    </OwnerGuard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1 },
  bodyWide: {
    flexDirection: "row",
    alignSelf: "center",
    width: "100%",
    paddingVertical: space[6],
  },
  content: { flex: 1, minWidth: 0 },
});
