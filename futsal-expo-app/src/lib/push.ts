import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken, unregisterPushToken } from "@/api";
import { STORAGE_KEYS, storage } from "@/lib/storage";

/**
 * Push notifications on the phone — `App\Services\PushSender` on the server.
 *
 * Notifications already work in this app without any of this: every event
 * writes a row, the bell polls, and `/notifications` lists them. What push adds
 * is finding out while the app is closed — "your booking was accepted" is only
 * useful before you stop caring, and a badge you have to go looking for is a
 * message you read too late.
 *
 * There are two halves, and only one of them needs anything from you:
 *
 *   1. **The bell, upgraded.** With permission granted, a notification that
 *      arrives while the app is open is presented as a real device banner
 *      instead of only moving a number in the navbar. That works today, in Expo
 *      Go, with no accounts or keys — see `announceNewNotifications`.
 *
 *   2. **Remote push.** For messages while the app is *closed*, Expo needs to
 *      know which app it is talking to, so the build needs an EAS project id:
 *
 *          EXPO_PUBLIC_EAS_PROJECT_ID=<uuid>   # or extra.eas.projectId in app.json
 *
 *      Without it this module registers nothing and says so once in the log —
 *      no crash, no prompt, no half-wired state. See futsal-expo-app/README.md.
 *
 * Everything here is best-effort: a phone that refuses permission still gets
 * the bell, and a failed registration is retried on the next launch.
 */

/** Set once, at import: without this a notification looks like a broken banner. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // A message that arrived while the app is open is still worth showing —
    // the player may be on a different screen entirely.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Which Expo project this build is.
 *
 * Read from the build config first (the normal EAS layout), then from the
 * environment so a build can be pointed at a project without editing app.json —
 * which is how the APK workflow enables push.
 */
export function pushProjectId(): string {
  const fromConfig =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId ??
    "";

  return fromConfig || process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "";
}

/** Is remote push configured in this build at all? */
export function remotePushConfigured(): boolean {
  return pushProjectId().length > 0;
}

let loggedMissingProject = false;

/**
 * Ask for permission and hand this phone's token to the backend.
 *
 * Returns a short human-readable result, which the settings screen shows so
 * "notifications are off" is never a mystery. Safe to call on every launch:
 * the server upserts on the token, and the permission prompt only appears once.
 */
export async function registerForPush(userId: number): Promise<
  { ok: true; token: string } | { ok: false; reason: string }
> {
  if (Platform.OS === "web") {
    // Browsers need a service worker and a VAPID key; the web build deliberately
    // sticks to the in-app bell.
    return { ok: false, reason: "Push notifications are for the phone app." };
  }

  try {
    // Android 13+ asks per app; on older versions this resolves granted.
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }

    if (status !== "granted") {
      return { ok: false, reason: "Notifications are blocked for Futsal Mate in your phone's settings." };
    }

    const projectId = pushProjectId();

    if (!projectId) {
      if (!loggedMissingProject) {
        loggedMissingProject = true;
        console.log(
          "[push] No EAS project id in this build, so remote push stays off. " +
            "Notifications still arrive in the bell while the app is open.",
        );
      }

      // Permission and the bell are still worth having: the local half works.
      return { ok: false, reason: "This build has no Expo project id, so remote push is off. The bell still works." };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await registerPushToken({
      userId,
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      deviceName: Device.deviceName ?? Device.modelName ?? "",
    });

    await storage.set(STORAGE_KEYS.pushToken, token);

    return { ok: true, token };
  } catch (error) {
    // Offline, no Play Services, a simulator without push support — all of it
    // lands here and none of it is worth failing a sign-in over.
    return { ok: false, reason: pushErrorReason(error) };
  }
}

function pushErrorReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");

  if (/network|timeout|offline/i.test(text)) {
    return "Could not reach the notification service. We will try again next time.";
  }

  if (/physical device|simulator|emulator/i.test(text)) {
    return "This device cannot receive push notifications (simulators cannot).";
  }

  return "Could not set up notifications on this phone. The bell still works.";
}

/** Forget this phone — signing out, or the player turned the switch off. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = storage.getCached(STORAGE_KEYS.pushToken);

    if (token) {
      await unregisterPushToken(token);
      await storage.remove(STORAGE_KEYS.pushToken);
    }
  } catch {
    // A phone that fails to unregister gets cleaned up by Expo's
    // DeviceNotRegistered receipt the next time we try to push to it.
  }
}

/**
 * Where a tapped notification should take the player.
 *
 * The payload is the same `link` the bell row carries ("/bookings?focus=12"),
 * so a tap lands on the exact screen the message is about.
 */
export function linkFromNotification(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const link = (data as { link?: unknown }).link;

  if (typeof link !== "string" || !link.startsWith("/")) return null;

  return link;
}

/**
 * Show a device banner for notifications that arrived while the app is open.
 *
 * Called by the bell after each poll. The first call only records what is
 * already there — otherwise opening the app would fire a banner for every
 * unread row in the inbox, which is the opposite of useful.
 */
const seen = new Set<number>();
let primed = false;

export async function announceNewNotifications(
  items: Array<{ id: number; title: string; message: string; isRead: boolean; link?: string | null }>,
): Promise<void> {
  if (Platform.OS === "web") return;

  const unread = items.filter((n) => !n.isRead);

  if (!primed) {
    unread.forEach((n) => seen.add(n.id));
    primed = true;
    return;
  }

  const fresh = unread.filter((n) => !seen.has(n.id));
  fresh.forEach((n) => seen.add(n.id));

  if (fresh.length === 0) return;

  try {
    // One banner per poll, not one per row: three new notes about the same match
    // should be a single interruption.
    const [first] = fresh;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: first.title,
        body: fresh.length > 1 ? `${first.message}\n(+${fresh.length - 1} more)` : first.message,
        data: { link: first.link ?? "" },
      },
      trigger: null,
    });
  } catch {
    // No permission, or the platform refused — the bell already moved.
  }
}

/**
 * Listen for taps and route to the link the message carries.
 *
 * `getLastNotificationResponseAsync` covers the cold start: the app was killed,
 * the player tapped the banner, and the route has to be honoured once the
 * router exists.
 */
export function attachPushListeners(push: (link: string) => void): () => void {
  if (Platform.OS === "web") return () => {};

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const link = linkFromNotification(response.notification.request.content.data);
    if (link) push(link);
  });

  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      const link = response ? linkFromNotification(response.notification.request.content.data) : null;
      if (link) push(link);
    })
    .catch(() => {
      /* nothing to resume */
    });

  return () => sub.remove();
}
