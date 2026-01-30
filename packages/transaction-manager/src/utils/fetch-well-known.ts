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
    | { jwk?: Base64URLString; trustedDevices?: Base64URLString[] }
    | null
    | undefined;

  if (!responseData?.jwk) {
    throw new Error(`Invalid .well-known response from ${clientOrigin}`);
  }
  const result: WellKnownClientCacheEntry = {
    clientJwk: responseData.jwk,
    trustedDeviceJwks: responseData.trustedDevices,
    cachedAt: currentTimestamp,
  };
  wellKnownClientCache.set(clientOrigin, result);

  return result;
}
