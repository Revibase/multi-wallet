import z from "zod";
import { WalletStorageError } from "./errors.js";

/**
 * Storage key for wallet account data
 */
const STORAGE_KEY = "Revibase:account";

/**
 * Type definition for stored account data
 */

const StoredAccountDataSchema = z.object({
  publicKey: z.string().nullable(),
  member: z.string().nullable(),
  settingsIndexWithAddress: z
    .object({
      index: z.union([z.number(), z.bigint()]),
      settingsAddressTreeIndex: z.number(),
    })
    .nullable(),
});
export type StoredAccountData = z.infer<typeof StoredAccountDataSchema>;
/**
 * Safely retrieves account data from localStorage
 *
 * @returns Account data or null if not found/invalid
 * @throws {WalletStorageError} If localStorage access fails
 */
export function getStoredAccount(): StoredAccountData | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const parsed = StoredAccountDataSchema.parse(JSON.parse(stored) as unknown);
    return parsed;
  } catch (error) {
    // If JSON parsing fails, clear corrupted data
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore cleanup errors
    }
    throw new WalletStorageError(
      `Failed to parse stored account data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Safely stores account data to localStorage
 *
 * @param data - Account data to store
 * @throws {WalletStorageError} If localStorage access fails
 */
export function setStoredAccount(data: StoredAccountData): void {
  if (typeof window === "undefined") {
    throw new WalletStorageError("localStorage is not available");
  }

  try {
    const serialized = JSON.stringify(data, (key, value) =>
      typeof value === "bigint" ? Number(value.toString()) : value,
    );
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    throw new WalletStorageError(
      `Failed to store account data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Removes account data from localStorage
 *
 * @throws {WalletStorageError} If localStorage access fails
 */
export function removeStoredAccount(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    throw new WalletStorageError(
      `Failed to remove account data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
