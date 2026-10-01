import { STORAGE_KEYS, initStorage, storage } from "@/lib/storage";

/**
 * Which checkout the app runs: the gateways' own test servers, or the built-in
 * demo replica.
 *
 * The real test servers are the default everywhere — they are the feature. But
 * a demo should not depend on eSewa's shared test wallets having money in them,
 * on Khalti's sandbox being up, or on the venue's Wi-Fi reaching either. This
 * module owns that choice:
 *
 *   • `EXPO_PUBLIC_PAYMENT_MODE=demo` a build that leads with the replica;
 *   • `EXPO_PUBLIC_PAYMENT_MODE=simulator` the older no-network escape hatch,
 *     which is the same thing under a different name;
 *   • otherwise the default is the real test server, and the switch in
 *     Settings (persisted, see `setDemoPayments`) is what moves it.
 *
 * The choice is read *at checkout time* (`demoPayments()`), not at import time,
 * so flipping the switch takes effect on the next payment instead of the next
 * app start.
 */

const configured = (process.env.EXPO_PUBLIC_PAYMENT_MODE ?? "").trim().toLowerCase();

let demo = configured === "demo" || configured === "simulator";
let hydrated = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** True when the next checkout should run the demo replica. */
export function demoPayments(): boolean {
  return demo;
}

/** Choose the demo replica, or the real test servers. Persisted. */
export function setDemoPayments(next: boolean): void {
  demo = next;
  void storage.set(STORAGE_KEYS.demoPayments, next ? "1" : "0");
  announce();
}

/** Subscribe to the choice; returns the unsubscribe. */
export function subscribePaymentMode(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Load the saved choice once at start-up.
 *
 * Runs after `initStorage()`, so the cached read is synchronous and a screen
 * rendering immediately afterwards sees the choice the player left behind —
 * rather than the default for a moment, which would be a whole checkout if they
 * tapped Pay in that moment.
 */
export async function hydratePaymentMode(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  await initStorage();

  const raw = storage.getCached(STORAGE_KEYS.demoPayments);

  if (raw === "1" || raw === "0") {
    demo = raw === "1";
    announce();
  }
}
