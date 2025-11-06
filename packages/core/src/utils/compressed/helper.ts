import type { Address } from "gill";
import {
  type CompressedSettingsData,
  fetchMaybeSettings,
  getCompressedSettingsAddressFromIndex,
  getCompressedSettingsDecoder,
  getUserAccountAddress,
  getUserDecoder,
  Secp256r1Key,
  type User,
} from "../..";
import { getSettingsFromIndex } from "../addresses";
import { getSolanaRpc } from "../initialize";
import {
  getCachedWhitelistedAddressTree,
  getCompressedAccount,
} from "./internal";

export async function fetchUserAccountData(
  member: Address | Secp256r1Key,
  userAddressTreeIndex?: number,
  cachedAccounts?: Map<string, any>
): Promise<User> {
  const result = await fetchMaybeUserAccountData(
    member,
    userAddressTreeIndex,
    cachedAccounts
  );
  if (!result) {
    throw new Error("User cannot be found.");
  }
  return result;
}

export async function fetchMaybeUserAccountData(
  member: Address | Secp256r1Key,
  userAddressTreeIndex?: number,
  cachedAccounts?: Map<string, any>
): Promise<User | null> {
  const { address } = await getUserAccountAddress(member, userAddressTreeIndex);
  const result = await getCompressedAccount(address, cachedAccounts);
  if (!result?.data?.data) {
    return null;
  }
  return getUserDecoder().decode(result.data.data);
}

export async function fetchSettingsAccountData(
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: Map<string, any>
): Promise<CompressedSettingsData & { isCompressed: boolean }> {
  const settingsData = await fetchMaybeSettingsAccountData(
    index,
    settingsAddressTreeIndex,
    cachedAccounts
  );
  if (!settingsData) {
    throw new Error("Settings cannot be found.");
  }
  return settingsData;
}

export async function fetchMaybeSettingsAccountData(
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: Map<string, any>
): Promise<(CompressedSettingsData & { isCompressed: boolean }) | null> {
  try {
    const { address } = await getCompressedSettingsAddressFromIndex(
      index,
      settingsAddressTreeIndex
    );
    const result = await getCompressedAccount(address, cachedAccounts);
    if (!result?.data?.data) {
      return null;
    }
    const data = getCompressedSettingsDecoder().decode(result.data.data);
    if (data.data.__option === "None") {
      return null;
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
      members: result.data.members.slice(0, result.data.membersLen),
      isCompressed: false,
    };
  }
}

export async function getWhitelistedAddressTreeFromIndex(index: number) {
  const addressTrees = await getCachedWhitelistedAddressTree();
  if (index < 0 || index >= addressTrees.length) {
    throw new Error(`Invalid address tree index: ${index}`);
  }
  return addressTrees[index];
}

export async function getWhitelistedAddressTreeIndexFromAddress(
  addressTree: string
) {
  const addressTrees = await getCachedWhitelistedAddressTree();
  const index = addressTrees.findIndex((x) => x === addressTree);
  if (index === -1) {
    throw new Error(`Address tree not found: ${addressTree}`);
  }
  return index;
}
