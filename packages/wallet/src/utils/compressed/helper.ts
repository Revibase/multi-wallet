import {
  createBN254,
  deriveAddress,
  deriveAddressSeed,
  getDefaultAddressTreeInfo,
} from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU128Encoder,
  getUtf8Encoder,
} from "gill";
import {
  type CompressedSettingsData,
  fetchMaybeSettings,
  getCompressedSettingsDecoder,
  getUserDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Secp256r1Key,
  type User,
} from "../..";
import { ADDRESS_TREE_VERSION } from "../consts";
import { getSolanaRpc } from "../initialize";
import { getCompressedAccount } from "./internal";

export function getUserAccountAddress(member: Address | Secp256r1Key) {
  const addressSeed = deriveAddressSeed(
    [
      new Uint8Array(getUtf8Encoder().encode("user")),
      member instanceof Secp256r1Key
        ? member.toTruncatedBuffer()
        : new Uint8Array(getAddressEncoder().encode(member)),
      new Uint8Array(getUtf8Encoder().encode(ADDRESS_TREE_VERSION)),
    ],
    new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS.toString())
  );
  return createBN254(
    deriveAddress(
      addressSeed,
      new PublicKey(getDefaultAddressTreeInfo().tree)
    ).toString(),
    "base58"
  );
}

export async function fetchUserAccountData(
  member: Address | Secp256r1Key,
  cachedAccounts?: Map<string, any>
): Promise<User> {
  const result = await fetchMaybeUserAccountData(member, cachedAccounts);
  if (!result) {
    throw new Error("User cannot be found.");
  }
  return result;
}

export async function fetchMaybeUserAccountData(
  member: Address | Secp256r1Key,
  cachedAccounts?: Map<string, any>
): Promise<User | null> {
  const address = getUserAccountAddress(member);
  const result = await getCompressedAccount(address, cachedAccounts);
  if (!result?.data?.data) {
    return null;
  }
  return getUserDecoder().decode(result.data.data);
}

export function getCompressedSettingsAddressFromIndex(index: number | bigint) {
  const addressSeed = deriveAddressSeed(
    [
      new Uint8Array(getUtf8Encoder().encode("multi_wallet")),
      new Uint8Array(getU128Encoder().encode(index)),
      new Uint8Array(getUtf8Encoder().encode(ADDRESS_TREE_VERSION)),
    ],
    new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS)
  );
  return createBN254(
    deriveAddress(
      addressSeed,
      new PublicKey(getDefaultAddressTreeInfo().tree)
    ).toString(),
    "base58"
  );
}

export async function fetchSettingsData(
  index: number | bigint,
  cachedAccounts?: Map<string, any>
): Promise<CompressedSettingsData & { isCompressed: boolean }> {
  try {
    const address = getCompressedSettingsAddressFromIndex(index);
    const result = await getCompressedAccount(address, cachedAccounts);
    if (!result?.data?.data) {
      throw new Error("Settings account does not exist.");
    }
    const data = getCompressedSettingsDecoder().decode(result.data.data);
    if (data.data.__option === "None") {
      throw new Error("Settings account does not exist.");
    }
    return { ...data.data.value, isCompressed: true };
  } catch {
    const result = await fetchMaybeSettings(
      getSolanaRpc(),
      await getSettingsFromIndex(index)
    );
    if (!result.exists) {
      throw new Error("Settings account does not exist.");
    }
    return {
      ...result.data,
      members: result.data.members.slice(0, result.data.membersLen),
      isCompressed: false,
    };
  }
}
export async function getWalletAddressFromSettings(settings: Address) {
  const [address] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("multi_wallet"),
      getAddressEncoder().encode(settings),
      getUtf8Encoder().encode("vault"),
    ],
  });

  return address;
}
export async function getSettingsFromIndex(index: number | bigint) {
  const [settings] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("multi_wallet"),
      getU128Encoder().encode(index),
    ],
  });

  return settings;
}
export async function getWalletAddressFromIndex(index: number | bigint) {
  const settings = await getSettingsFromIndex(index);
  const address = await getWalletAddressFromSettings(settings);
  return address;
}
