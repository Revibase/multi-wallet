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
  getU128Encoder,
  getUtf8Encoder,
} from "gill";
import {
  type CompressedSettingsData,
  type Delegate,
  fetchMaybeSettings,
  getCompressedSettingsDecoder,
  getDelegateDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Secp256r1Key,
} from "../..";
import { ADDRESS_TREE_VERSION } from "../consts";
import { getSettingsFromIndex } from "../helper";
import { getSolanaRpc } from "../initialize";
import { getCompressedAccount } from "./internal";

export function getDelegateAddress(member: Address | Secp256r1Key) {
  const addressSeed = deriveAddressSeed(
    [
      new Uint8Array(getUtf8Encoder().encode("delegate")),
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

export async function fetchDelegateData(
  member: Address | Secp256r1Key,
  cachedCompressedAccounts?: Map<string, any>
): Promise<Delegate> {
  const result = await fetchMaybeDelegateData(member, cachedCompressedAccounts);
  if (!result) {
    throw new Error("User cannot be found.");
  }
  return result;
}

export async function fetchMaybeDelegateData(
  member: Address | Secp256r1Key,
  cachedCompressedAccounts?: Map<string, any>
): Promise<Delegate | null> {
  const delegateAddress = getDelegateAddress(member);
  const result = await getCompressedAccount(
    delegateAddress,
    cachedCompressedAccounts
  );
  if (!result?.data?.data) {
    return null;
  }
  return getDelegateDecoder().decode(result.data.data);
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
  cachedCompressedAccounts?: Map<string, any>
): Promise<CompressedSettingsData & { isCompressed: boolean }> {
  try {
    const address = getCompressedSettingsAddressFromIndex(index);
    const result = await getCompressedAccount(
      address,
      cachedCompressedAccounts
    );
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
