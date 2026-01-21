/**
 * Cache utilities for optimized account data retrieval
 */

import type { AccountCache, CachedAccountData } from "../types";

/**
 * Creates a cache key for compressed account lookups
 * @param address - Account address (BN or string)
 * @returns Cache key string
 */
export function createCompressedAccountCacheKey(
  address: { toString(): string } | string,
): string {
  return typeof address === "string" ? address : address.toString();
}

/**
 * Creates a cache key for regular account info lookups
 * @param address - Account address
 * @returns Cache key string
 */
export function createAccountInfoCacheKey(address: {
  toString(): string;
}): string {
  return address.toString();
}

/**
 * Gets a value from cache or executes the fetcher function
 * @param cache - Optional cache map
 * @param key - Cache key
 * @param fetcher - Function to fetch the value if not in cache
 * @returns Cached or fetched value
 */
export async function getCachedOrFetch<T extends CachedAccountData>(
  cache: AccountCache | undefined,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = cache?.get(key);
  if (cached) {
    return cached as T;
  }

  const value = await fetcher();
  if (value && cache) {
    cache.set(key, value);
  }
  return value;
}
