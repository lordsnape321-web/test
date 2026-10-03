import { ArrowLeft, ArrowRight, Check, ChevronRight, Trash2 } from "lucide-react-native";
import React, { useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { timeAgo } from "@/lib/time";
import type { AppNotification } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

type Badge = { bg: string; text: string };

export function SwipeNotificationRow({
  notification: n,
  badge,
  owner = false,
  onOpen,
  onRead,
  onDelete,
}: {
  notification: AppNotification;
  badge: Badge;
  owner?: boolean;
  onOpen: (notification: AppNotification) => void;
  onRead: (notification: AppNotification) => void;
  onDelete: (id: number) => void;
}) {
  const { colors: c, isDark } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const swiped = useRef(false);
  const suppressPress = useRef(false);
  const [offset, setOffset] = useState(0);

  function setPosition(next: number) {
    const clamped = Math.max(-132, Math.min(132, next));
    offsetRef.current = clamped;
    setOffset(clamped);
    translateX.setValue(clamped);
  }

  function resetPosition() {
    offsetRef.current = 0;
    setOffset(0);
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: Platform.OS !== "web",
      bounciness: 0,
      speed: 24,
    }).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: () => {
        swiped.current = false;
      },
      onPanResponderMove: (_, gesture) => {
        if (Math.abs(gesture.dx) > 6) swiped.current = true;
        setPosition(gesture.dx);
      },
      onPanResponderRelease: () => {
        const finalOffset = offsetRef.current;
        if (!swiped.current) {
          resetPosition();
          return;
        }

        suppressPress.current = true;
        if (finalOffset >= 72 && !n.isRead) {
          Animated.timing(translateX, { toValue: 112, duration: 150, useNativeDriver: Platform.OS !== "web" }).start(() => {
            onRead(n);
            resetPosition();
          });
        } else if (finalOffset <= -72) {
          Animated.timing(translateX, { toValue: -112, duration: 150, useNativeDriver: Platform.OS !== "web" }).start(() => {
            onDelete(n.id);
            resetPosition();
          });
        } else {
          resetPosition();
        }
        setTimeout(() => {
          suppressPress.current = false;
        }, 300);
      },
      onPanResponderTerminate: resetPosition,
    }),
  ).current;

  const surface = n.isRead
    ? { backgroundColor: isDark ? colors.slate900 : colors.stone50, borderColor: c.border }
    : {
        backgroundColor: isDark ? "rgba(16,185,129,0.14)" : colors.emerald50,
        borderColor: isDark ? "rgba(110,231,183,0.55)" : colors.emerald300,
      };

  // Swipe right (the row moves right) reveals the LEFT edge — that is where
  // "Mark read" belongs. Swipe left reveals the RIGHT edge, so Delete sits
  // there. One cue is drawn at a time, on the revealed side: `space-between`
  // with a single child pushed it to the opposite edge, where the row covered
  // it.
  const revealed = offset > 8 ? "left" : offset < -8 ? "right" : null;
  // Readable on both themes: the underlay is a solid slate/stone, and the cue
  // uses the light-theme dark red or the dark-theme bright one.
  const danger = isDark ? colors.red400 : colors.red600;
  const success = isDark ? colors.emerald400 : colors.emerald700;

  return (
    <View style={styles.swipeShell}>
      <View
        style={[
          styles.actionUnderlay,
          { backgroundColor: isDark ? colors.slate700 : colors.stone100, pointerEvents: "none" },
        ]}
      >
        {revealed === "left" && !n.isRead ? (
          <View style={styles.actionCue}>
            <ArrowRight size={15} color={colors.emerald600} />
            <Check size={15} color={colors.emerald600} />
            <Text style={[styles.readCue, { color: success }]}>Mark read</Text>
          </View>
        ) : null}
        {revealed === "right" ? (
          <View style={[styles.actionCue, styles.cueRight]}>
            <ArrowLeft size={15} color={danger} />
            <Trash2 size={15} color={danger} />
            <Text style={[styles.deleteCue, { color: danger }]}>Delete</Text>
          </View>
        ) : null}
      </View>

      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.noteRow, surface, { transform: [{ translateX }] }]}
      >
        <View style={styles.badgeColumn}>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.text }]}>
              {n.type.replace(/_/g, " ")}
            </Text>
          </View>
        </View>

        <View style={styles.noteContent}>
          <Pressable
            onPress={() => {
              if (!suppressPress.current) onOpen(n);
            }}
            accessibilityRole="button"
            accessibilityLabel={n.link ? `Open ${n.title}` : n.title}
            accessibilityHint="Swipe right to mark read or left to delete"
          >
            <Text style={[styles.noteTitle, { color: c.text }]}>{n.title}</Text>
            {n.message ? <Text style={[styles.noteMessage, { color: c.textMuted }]}>{n.message}</Text> : null}
            <View style={styles.noteMetaRow}>
              <Text style={[styles.noteMeta, { color: c.textFaint }]}>{timeAgo(n.createdAt)}</Text>
            </View>
          </Pressable>
          {n.link ? (
            <Pressable
              onPress={() => onOpen(n)}
              style={styles.lookButton}
              accessibilityRole="button"
              accessibilityLabel={owner ? "Open notification" : "Have a look at this notification"}
            >
              <Text style={styles.lookText}>{owner ? "Open" : "Have a look"}</Text>
              <ChevronRight size={13} color={colors.emerald600} />
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  swipeShell: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radius["2xl"],
  },
  actionUnderlay: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[4],
    backgroundColor: colors.stone100,
  },
  actionCue: { flexDirection: "row", alignItems: "center", gap: 4 },
  /** Delete is pinned to the edge a left swipe uncovers. */
  cueRight: { marginLeft: "auto" },
  readCue: { fontSize: fontSize["2xs"], fontWeight: "900" },
  deleteCue: { fontSize: fontSize["2xs"], fontWeight: "900" },
  noteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
  },
  badgeColumn: { width: 96, flexShrink: 0 },
  noteContent: { flex: 1, minWidth: 0 },
  badge: {
    width: "100%",
    minHeight: 32,
    justifyContent: "center",
    borderRadius: radius.xl,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: fontSize["2xs"],
    lineHeight: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    textAlign: "center",
  },
  noteTitle: { fontSize: fontSize.base, fontWeight: "800", lineHeight: 19 },
  noteMessage: { fontSize: 13, lineHeight: 19, marginTop: space[1] },
  noteMetaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1], marginTop: 6 },
  noteMeta: { fontSize: fontSize.xs, fontWeight: "700" },
  lookButton: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 2, marginTop: space[2], borderWidth: 1, borderColor: "rgba(16,185,129,0.35)", borderRadius: radius.full, paddingHorizontal: space[2.5], paddingVertical: space[1] },
  lookText: { fontSize: fontSize.xs, fontWeight: "800", color: colors.emerald600 },
});
