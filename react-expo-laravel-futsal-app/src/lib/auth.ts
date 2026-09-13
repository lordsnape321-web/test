import { createHash } from "node:crypto";

const SALT = "futsal-nepal::auth-v1";

/** Default password for seeded demo accounts (player + owner). */
export const DEFAULT_PASSWORD = "futsal123";

export function hashPassword(password: string): string {
  return createHash("sha256").update(`${SALT}::${password}`).digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  if (!hash) return false;
  return hashPassword(password) === hash;
}

export function safeUser<T extends { passwordHash?: string }>(u: T) {
  const { passwordHash: _ignored, ...rest } = u;
  void _ignored;
  return rest;
}
