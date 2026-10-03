import { STORAGE_KEYS, initStorage, storage } from "@/lib/storage";

/**
 * Which checkout the app runs: the replica of the gateway pages, or the
 * gateways' own test servers.
 *
 * The replica is the default. eSewa's test wallets are shared between every
 * integrator ("adequate balance will be updated to test user account" is a
 * promise, not a standing balance), Khalti's sandbox locks accounts, and
 * neither is reachable from wherever a demo might happen — none of which is
 * something a checkout the app depends on can afford. The replica is the same
 * three steps on the same page path, and it settles through the same verify
 * endpoint, so the app behaves identically either way.
 *
 * What this module owns:
 *
 *   • the default — the replica;
 *   • `EXPO_PUBLIC_PAYMENT_MODE=real` for a build that leads with the real test
 *     servers (and `demo`/`simulator` to say the default out loud);
 *   • the switch in Settings (persisted, see `setDemoPayments`), which is the
 *     same choice made at runtime.
 *
 * The choice is read *at checkout time* (`demoPayments()`), not at import time,
 * so flipping the switch takes effect on the next payment instead of the next
 * app start.
 */

const configured = (process.env.EXPO_PUBLIC_PAYMENT_MODE ?? "").trim().toLowerCase();

let demo = configured !== "real";
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
