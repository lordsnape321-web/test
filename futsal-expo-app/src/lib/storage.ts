import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Small client-side persistence: the session id and a few UI preferences.
 *
 * This is the React Native counterpart of src/lib/storage.ts in the Next.js app,
 * which wrapped localStorage. The two cannot share an implementation because
 * AsyncStorage is asynchronous and localStorage is not — that asymmetry is the
 * single real difference between the two platforms for this concern.
 *
 * The design mirrors the web version: an in-memory map is the source of truth
 * for synchronous reads, and AsyncStorage is the durable backing store. Call
 * `initStorage()` once at app start (App/_layout.tsx does) to hydrate the map;
 * after that `getCached()` is safe to read during render.
 *
 * Everything here is fail-soft. AsyncStorage throws when it is unavailable or
 * full, and losing a cached preference must never crash the app.
 */

const memory = new Map<string, string>();
let ready = false;

/** Keys this app persists. Keeping the list explicit lets init hydrate them. */
export const STORAGE_KEYS = {
  session: "futsal.session.userId",
  theme: "futsal.theme",
} as const;

const HYDRATE = Object.values(STORAGE_KEYS);

/**
 * Load known keys from AsyncStorage into memory. Idempotent.
 *
 * AsyncStorage v3 dropped multiGet, so this reads the handful of keys
 * individually and in parallel. The key list is short and fixed, so the extra
 * round trips are negligible.
 */
export async function initStorage(): Promise<void> {
  if (ready) return;
  try {
    const values = await Promise.all(
      HYDRATE.map((key) => AsyncStorage.getItem(key).catch(() => null)),
    );
    HYDRATE.forEach((key, i) => {
      const value = values[i];
      if (value !== null && value !== undefined) memory.set(key, value);
    });
  } catch {
    // Storage unavailable — the app still works, it just won't remember.
  }
  ready = true;
}

/** True once initStorage() has finished its first run. */
export function isStorageReady(): boolean {
  return ready;
}

export const storage = {
  /** Read-through: memory first, then AsyncStorage. */
  async get(key: string): Promise<string | null> {
    const cached = memory.get(key);
    if (cached !== undefined) return cached;
    try {
      const value = await AsyncStorage.getItem(key);
      if (value !== null && value !== undefined) memory.set(key, value);
      return value;
    } catch {
      return null;
    }
  },

  /** Synchronous read of a previously hydrated value. Null before init. */
  getCached(key: string): string | null {
    return memory.get(key) ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    memory.set(key, value);
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // Kept in memory for this session at least.
    }
  },

  async remove(key: string): Promise<void> {
    memory.delete(key);
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Nothing useful to do; memory is already clear.
    }
  },

  /**
   * Seed memory without touching AsyncStorage.
   * Useful in tests, and for restoring a session from a secure store.
   */
  hydrate(entries: Record<string, string | null | undefined>): void {
    for (const [key, value] of Object.entries(entries)) {
      if (value === null || value === undefined) memory.delete(key);
      else memory.set(key, value);
    }
  },
};
