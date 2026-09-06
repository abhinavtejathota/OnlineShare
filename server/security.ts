import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { customAlphabet } from "nanoid";

/**
 * Share IDs: 22 chars from a 62-char alphabet ≈ 131 bits of entropy.
 * Brute-forcing a valid ID is computationally infeasible.
 */
const shareAlphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const generateShareId = customAlphabet(shareAlphabet, 22);

/** Owner tokens: 32 bytes → 64 hex chars. Shown once; required to delete. */
export function generateOwnerToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyOwnerToken(token: string, hash: string): boolean {
  const candidate = hashOwnerToken(token);
  try {
    return timingSafeEqual(
      Buffer.from(candidate, "hex"),
      Buffer.from(hash, "hex"),
    );
  } catch {
    return false;
  }
}
