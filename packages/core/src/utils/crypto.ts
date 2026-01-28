/**
 * Cryptographic utilities using Web Crypto API
 */

/**
 * Computes SHA256 hash using crypto.subtle
 * @param data - Data to hash as Uint8Array
 * @returns SHA256 hash as Uint8Array
 */
export async function sha256(
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}
