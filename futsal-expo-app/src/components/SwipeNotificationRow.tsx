import { ArrowLeft, ArrowRight, Check, ChevronRight, Trash2 } from "lucide-react-native";
import React, { useRef, useState } from "react";
import {
  Animated,
  PanResponder,
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
      useNativeDriver: true,
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
          Animated.timing(translateX, { toValue: 112, duration: 150, useNativeDriver: true }).start(() => {
            onRead(n);
            resetPosition();
          });
        } else if (finalOffset <= -72) {
          Animated.timing(translateX, { toValue: -112, duration: 150, useNativeDriver: true }).start(() => {
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

  return (
    <View style={styles.swipeShell}>
      <View style={[styles.actionUnderlay, { backgroundColor: c.inset }]} pointerEvents="none">
        {offset > 8 && !n.isRead ? (
          <View style={styles.actionCue}>
            <ArrowRight size={15} color={colors.emerald600} />
            <Check size={15} color={colors.emerald600} />
            <Text style={[styles.readCue, { color: colors.emerald700 }]}>Mark read</Text>
          </View>
        ) : null}
        {offset < -8 ? (
          <View style={styles.actionCue}>
            <Text style={[styles.deleteCue, { color: colors.red600 }]}>Delete</Text>
            <Trash2 size={15} color={colors.red600} />
            <ArrowLeft size={15} color={colors.red600} />
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

        <Pressable
          style={styles.noteContent}
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
            {n.link ? (
              <View style={styles.lookRow}>
                <Text style={styles.lookText}>{owner ? "Open" : "Have a look"}</Text>
                <ChevronRight size={12} color={colors.emerald600} />
              </View>
            ) : null}
          </View>
        </Pressable>
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
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    backgroundColor: "#F1F5F9",
  },
  actionCue: { flexDirection: "row", alignItems: "center", gap: 4 },
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
  lookRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  lookText: { fontSize: fontSize.xs, fontWeight: "700", color: colors.emerald600 },
});
