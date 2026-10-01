import { Alert, Platform } from "react-native";

/**
 * The browser's own dialogs, for the web build.
 *
 * `Alert.alert` is native-only: react-native-web does not implement it, so on
 * web the call is a no-op and whatever button made it looks broken. That is
 * exactly what happened to the booking desk's **Decline** — it asked
 * "Decline this booking request?" through `Alert.alert`, so on the web console
 * nothing happened at all while the same button worked on a phone.
 *
 * These two helpers are the one place that difference lives: a real native
 * alert on iOS/Android, the browser's own confirm/alert on web. Everything
 * else in the app keeps calling them and stays platform-blind.
 */

function browserConfirm(text: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false;

  return window.confirm(text);
}

export type ConfirmOptions = {
  title: string;
  message?: string;
  /** The button that does the thing. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red on native, and the "danger" framing in the browser dialog's copy. */
  destructive?: boolean;
};

/**
 * Ask before doing something the app cannot undo, on every platform.
 *
 * `onConfirm` runs only when the payer says yes.
 */
export function confirmAction(
  {
    title,
    message = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = false,
  }: ConfirmOptions,
  onConfirm: () => void,
): void {
  if (Platform.OS === "web") {
    const body = destructive ? `${title}\n\n${message}` : `${title}\n\n${message}`;

    if (browserConfirm(body.trim())) onConfirm();
    return;
  }

  Alert.alert(title, message || undefined, [
    { text: cancelLabel, style: "cancel" },
    { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: onConfirm },
  ]);
}

/** Say that something went wrong — native alert, or the browser's own. */
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }

  Alert.alert(title, message);
}
