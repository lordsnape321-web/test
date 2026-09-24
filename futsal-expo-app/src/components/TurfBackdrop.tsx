import React, { useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "@/context/ThemeContext";

/**
 * TurfBackdrop — a native rendering of the web app's `.turf-pattern` class
 * from globals.css.
 *
 * Light: peach base #FFF9F0 + orange / emerald / amber radial blobs + a 26px
 * brown dotted texture. Dark: slate-950 base + blue / emerald / indigo blobs
 * (no dots — the source deliberately drops the speckles on a near-black base).
 *
 * Absolute-fill; put it under screen content with `pointerEvents="none"`.
 */
export function TurfBackdrop({ style }: { style?: object }) {
  const { isDark, studio } = useTheme();
  const { width, height } = useWindowDimensions();

  const blobs = useMemo(() => {
    if (isDark) {
      return [
        { cx: width * 0.12, cy: height * 0.08, r: Math.max(width, 400) * 0.34, c: "rgba(59,130,246,0.12)" },
        { cx: width * 0.88, cy: height * 0.12, r: Math.max(width, 400) * 0.36, c: "rgba(16,185,129,0.12)" },
        { cx: width * 0.5, cy: height * 1.0, r: Math.max(width, 400) * 0.42, c: "rgba(99,102,241,0.08)" },
      ];
    }
    return [
      { cx: width * 0.12, cy: height * 0.08, r: Math.max(width, 400) * 0.34, c: "rgba(249,115,22,0.10)" },
      { cx: width * 0.88, cy: height * 0.12, r: Math.max(width, 400) * 0.36, c: "rgba(5,150,105,0.10)" },
      { cx: width * 0.5, cy: height * 1.0, r: Math.max(width, 400) * 0.42, c: "rgba(251,191,36,0.12)" },
    ];
  }, [isDark, width, height]);

  // Owner Studio is a flat slate workspace — no clubhouse pattern.
  if (studio) {
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: "#F1F5F9" }, style]}
      />
    );
  }

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "#020617" : "#FFF9F0" }, style]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          {/* radial-gradient(circle at …) equivalents */}
          <RadialGradient id="blobA" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={blobs[0].c} />
            <Stop offset="1" stopColor={blobs[0].c} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="blobB" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={blobs[1].c} />
            <Stop offset="1" stopColor={blobs[1].c} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="blobC" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={blobs[2].c} />
            <Stop offset="1" stopColor={blobs[2].c} stopOpacity="0" />
          </RadialGradient>
          {!isDark ? (
            <Pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
              <Circle cx="1.2" cy="1.2" r="1.2" fill="rgba(120,80,40,0.08)" />
            </Pattern>
          ) : null}
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#blobA)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#blobB)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#blobC)" />
        {!isDark ? <Rect x="0" y="0" width="100%" height="100%" fill="url(#dots)" /> : null}
      </Svg>
    </View>
  );
}
