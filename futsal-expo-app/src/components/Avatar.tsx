import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { initials } from "@/lib/futsal";

/**
 * Avatar — a 1:1 port of the web app's components/Avatar.tsx.
 *
 * Same rule as the original: if the user has an avatarUrl, show the photo over
 * their avatarColor; otherwise show their initials on that colour. The colour
 * always backs the image so a slow or broken load degrades to the initial tile
 * rather than a grey box.
 *
 * The web component sizes itself with Tailwind classes (h-8 w-8 text-xs). Here
 * that becomes an explicit `size` number, with the font size derived from it at
 * the same ratio the web classes use (text-xs = 12px at h-8 = 32px, i.e. 0.375).
 */

export type AvatarUser = {
  name: string;
  avatarColor: string;
  avatarUrl?: string | null;
};

export function Avatar({
  user,
  size = 32,
  rounded = true,
  ring,
}: {
  user: AvatarUser;
  /** Width/height in points. 32 matches the web default h-8 w-8. */
  size?: number;
  /** False gives a squarer tile; the web default is rounded-full. */
  rounded?: boolean;
  /** Optional ring, e.g. 2px white — used for the overlapping player stack. */
  ring?: { width: number; color: string };
}) {
  const url = (user.avatarUrl ?? "").trim();
  const radius = rounded ? size / 2 : size * 0.25;

  const box = {
    width: size,
    height: size,
    borderRadius: radius,
    backgroundColor: user.avatarColor,
    ...(ring ? { borderWidth: ring.width, borderColor: ring.color } : null),
  } as const;

  return (
    <View style={[styles.box, box]}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityLabel={user.name}
        />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.375 }]}>
          {initials(user.name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  initials: { color: "#FFFFFF", fontWeight: "900" },
});
