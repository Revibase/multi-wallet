import type { WellKnownClientCacheEntry } from "src/types";

const WELL_KNOWN_CACHE_TTL_MS = 300_000;
const wellKnownClientCache = new Map<string, WellKnownClientCacheEntry>();
export async function fetchWellKnownClient(
  clientOrigin: string,
  wellKnownProxyUrl?: URL,
): Promise<WellKnownClientCacheEntry> {
  const currentTimestamp = Date.now();
  const cachedEntry = wellKnownClientCache.get(clientOrigin);

  if (
    cachedEntry &&
    currentTimestamp - cachedEntry.cachedAt < WELL_KNOWN_CACHE_TTL_MS
  ) {
    return cachedEntry;
  }

  const fetchUrl = wellKnownProxyUrl
    ? `${wellKnownProxyUrl.origin}?origin=${encodeURIComponent(clientOrigin)}`
    : `${clientOrigin}/.well-known/revibase.json`;

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch .well-known/revibase.json for ${clientOrigin}`,
    );
  }

  const responseData = (await response.json()) as
    | Omit<WellKnownClientCacheEntry, "cachedAt">
    | null
    | undefined;

  if (!responseData?.clientJwk) {
    throw new Error(`Invalid .well-known response from ${clientOrigin}`);
  }
  const result: WellKnownClientCacheEntry = {
    ...responseData,
    cachedAt: currentTimestamp,
  };
  wellKnownClientCache.set(clientOrigin, result);

  return result;
}
