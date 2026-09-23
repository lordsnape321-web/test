/**
 * One seam for small client-side persistence (theme preference, session id).
 *
 * Why this exists
 * ---------------
 * These values used to be read and written with bare `localStorage.*` calls
 * scattered across the components. That is a problem for the Expo port, because
 * React Native has no `localStorage` — the equivalent is `AsyncStorage` from
 * @react-native-async-storage/async-storage.
 *
 * Routing them through here means the port touches this one module instead of
 * every component that remembers something.
 *
 * The interface is deliberately synchronous because every current caller needs
 * a value immediately during render or in an effect. AsyncStorage is async, so
 * the RN swap is not a drop-in: in Expo, hydrate this module once at app start
 * (await AsyncStorage.multiGet, seed the in-memory map) and the synchronous
 * reads below then serve from memory. That is why the map is the source of
 * truth and web storage is treated as a write-through cache.
 *
 * It also makes these reads safe today: if `localStorage` is unavailable —
 * private-browsing restrictions, a non-browser runtime, an SSR pass — the map
 * carries the values instead of throwing.
 */

const memory = new Map<string, string>();

/** The real web storage, or null where it doesn't exist or is blocked. */
function web(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // Safari private mode throws on mere access
  }
}

export const storage = {
  get(key: string): string | null {
    const cached = memory.get(key);
    if (cached !== undefined) return cached;
    const value = web()?.getItem(key) ?? null;
    if (value !== null) memory.set(key, value);
    return value;
  },

  set(key: string, value: string): void {
    memory.set(key, value);
    try {
      web()?.setItem(key, value);
    } catch {
      // Quota or blocked storage — the value still lives in memory.
    }
  },

  remove(key: string): void {
    memory.delete(key);
    try {
      web()?.removeItem(key);
    } catch {
      // Nothing sensible to do; memory is already clear.
    }
  },

  /**
   * Seed the in-memory map without touching web storage.
   * This is the hook the Expo port uses to load AsyncStorage at startup.
   */
  hydrate(entries: Record<string, string | null | undefined>): void {
    for (const [key, value] of Object.entries(entries)) {
      if (value === null || value === undefined) memory.delete(key);
      else memory.set(key, value);
    }
  },
};
