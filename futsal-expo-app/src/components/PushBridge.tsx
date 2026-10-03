import { useRouter } from "expo-router";
import React from "react";
import { useAuth } from "@/context/AuthContext";
import { attachPushListeners, registerForPush, unregisterPush } from "@/lib/push";

/**
 * The half of push notifications that has no UI.
 *
 * Mounted once, inside AuthProvider (see app/_layout.tsx). It does exactly two
 * things, both invisible:
 *
 *   • **Keeps the server's idea of "this account's phones" true.** On sign-in it
 *     asks for permission and registers the token; on sign-out it hands the
 *     token back so the next person to hold this phone does not get a previous
 *     player's notifications. Registration is idempotent, so a relaunch is free.
 *
 *   • **Routes taps.** A notification carries the same `link` the bell row does
 *     ("/bookings?focus=12"), so tapping it lands on the screen the message is
 *     about — including from a cold start, which is the case that matters most
 *     for a notification.
 *
 * It renders nothing and swallows every failure: a phone with notifications
 * switched off is still a perfectly good app, just a quieter one.
 */
export function PushBridge() {
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?.id ?? 0;
  const registered = React.useRef(0);

  React.useEffect(() => {
    return attachPushListeners((link) => router.push(link as never));
  }, [router]);

  React.useEffect(() => {
    // Signed out: forget the handset. Guarded by the ref so this fires on the
    // transition, not on every render of a signed-out app.
    if (!userId) {
      if (registered.current) {
        registered.current = 0;
        void unregisterPush();
      }

      return;
    }

    if (registered.current === userId) return;
    registered.current = userId;
    void registerForPush(userId);
  }, [userId]);

  return null;
}
