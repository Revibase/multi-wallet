import { type Address } from "gill";
import {
  fetchMaybeSettings,
  getCompressedSettingsAddressFromIndex,
  getCompressedSettingsDecoder,
  getUserAccountAddress,
  getUserDecoder,
  Secp256r1Key,
  type CompressedSettingsData,
  type User,
} from "../..";
import { NotFoundError, ValidationError } from "../../errors";
import { requireNonNegative } from "../validation";
import type { AccountCache } from "../../types";
import { getSettingsFromIndex } from "../addresses";
import { getSolanaRpc } from "../initialize";
import {
  fetchCachedCompressedAccount,
  getCachedWhitelistedAddressTree,
} from "./internal";

/**
 * Fetches user account data, throwing if not found
 * @param member - Member address or Secp256r1Key
 * @param userAddressTreeIndex - Optional address tree index
 * @param cachedAccounts - Optional cache for account data
 * @returns User account data
 * @throws {NotFoundError} If user account is not found
 */
export async function fetchUserAccountData(
  member: Address | Secp256r1Key,
  userAddressTreeIndex?: number,
  cachedAccounts?: AccountCache
): Promise<User> {
  const result = await fetchMaybeUserAccountData(
    member,
    userAddressTreeIndex,
    cachedAccounts
  );
  if (!result) {
    throw new NotFoundError("User account");
  }
  return result;
}

export async function fetchMaybeUserAccountData(
  member: Address | Secp256r1Key,
  userAddressTreeIndex?: number,
  cachedAccounts?: AccountCache
): Promise<User | null> {
  const { address } = await getUserAccountAddress(member, userAddressTreeIndex);
  const result = await fetchCachedCompressedAccount(address, cachedAccounts);
  if (!result?.data?.data) {
    return null;
  }
  return getUserDecoder().decode(result.data.data);
}

/**
 * Fetches settings account data, throwing if not found
 * @param index - Settings index
 * @param settingsAddressTreeIndex - Optional address tree index
 * @param cachedAccounts - Optional cache for account data
 * @returns Settings account data with compression flag
 * @throws {NotFoundError} If settings account is not found
 */
export async function fetchSettingsAccountData(
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: AccountCache
): Promise<CompressedSettingsData & { isCompressed: boolean }> {
  const settingsData = await fetchMaybeSettingsAccountData(
    index,
    settingsAddressTreeIndex,
    cachedAccounts
  );
  if (!settingsData) {
    throw new NotFoundError("Settings account");
  }
  return settingsData;
}

export async function fetchMaybeSettingsAccountData(
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: AccountCache
): Promise<(CompressedSettingsData & { isCompressed: boolean }) | null> {
  try {
    const { address } = await getCompressedSettingsAddressFromIndex(
      index,
      settingsAddressTreeIndex
    );
    const result = await fetchCachedCompressedAccount(address, cachedAccounts);
    if (!result?.data?.data) {
      throw new NotFoundError("Compressed settings account");
    }
    const data = getCompressedSettingsDecoder().decode(result.data.data);
    if (data.data.__option === "None") {
      throw new NotFoundError("Compressed settings account");
    }
    return { ...data.data.value, isCompressed: true };
  } catch {
    const result = await fetchMaybeSettings(
      getSolanaRpc(),
      await getSettingsFromIndex(index)
    );
    if (!result.exists) {
      return null;
    }
    return {
      ...result.data,
      isCompressed: false,
    };
  }
}

/**
 * Gets whitelisted address tree by index
 * @param index - Address tree index
 * @returns Address tree address
 * @throws {ValidationError} If index is out of bounds
 */
export async function getWhitelistedAddressTreeFromIndex(
  index: number
): Promise<Address> {
  requireNonNegative(index, "index");
  const addressTrees = await getCachedWhitelistedAddressTree();
  if (index >= addressTrees.length) {
    throw new ValidationError(
      `Address tree index ${index} is out of bounds (max: ${addressTrees.length - 1})`
    );
  }
  return addressTrees[index];
}

/**
 * Gets whitelisted address tree index from address
 * @param addressTree - Address tree address as string
 * @returns Address tree index
 * @throws {NotFoundError} If address tree is not found
 */
export async function getWhitelistedAddressTreeIndexFromAddress(
  addressTree: string
): Promise<number> {
  const addressTrees = await getCachedWhitelistedAddressTree();
  const index = addressTrees.findIndex((x) => x.toString() === addressTree);
  if (index === -1) {
    throw new NotFoundError(
      "Address tree",
      `Address ${addressTree} not found in whitelist`
    );
  }
  return index;
}
