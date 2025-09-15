import {
  createBN254,
  deriveAddress,
  deriveAddressSeed,
  getDefaultAddressTreeInfo,
} from "@lightprotocol/stateless.js";
import {
  Address,
  getAddressEncoder,
  getU128Encoder,
  getUtf8Encoder,
} from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  CompressedSettingsData,
  fetchMaybeSettings,
  getCompressedSettingsDecoder,
  getUserDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Secp256r1Key,
  User,
} from "../..";
import { getSettingsFromIndex } from "../helper";
import { getSolanaRpc } from "../initialize";
import { getCompressedAccount } from "./internal";

export function getUserAddress(member: Address | Secp256r1Key) {
  const { tree } = getDefaultAddressTreeInfo();
  if (member instanceof Secp256r1Key) {
    const addressSeed = deriveAddressSeed(
      [
        new Uint8Array(getUtf8Encoder().encode("delegate")),
        member.toTruncatedBuffer(),
      ],
      new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS)
    );
    return createBN254(deriveAddress(addressSeed, tree).toString(), "base58");
  } else {
    const addressSeed = deriveAddressSeed(
      [
        new Uint8Array(getUtf8Encoder().encode("delegate")),
        new Uint8Array(getAddressEncoder().encode(member)),
      ],
      new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS)
    );
    return createBN254(deriveAddress(addressSeed, tree).toString(), "base58");
  }
}

export async function fetchUserData(
  member: Address | Secp256r1Key,
  cachedCompressedAccounts?: Map<string, any>
): Promise<User> {
  const userAddress = getUserAddress(member);
  const result = await getCompressedAccount(
    userAddress,
    cachedCompressedAccounts
  );
  if (!result?.data?.data) {
    throw Error("Unable to fetch user account data.");
  }
  return getUserDecoder().decode(result.data.data);
}

export async function fetchMaybeUserData(
  member: Address | Secp256r1Key,
  cachedCompressedAccounts?: Map<string, any>
): Promise<User | null> {
  const userAddress = getUserAddress(member);
  const result = await getCompressedAccount(
    userAddress,
    cachedCompressedAccounts
  );
  if (!result?.data?.data) {
    return null;
  }
  return getUserDecoder().decode(result.data.data);
}

export function getCompressedSettingsAddressFromIndex(index: number | bigint) {
  const { tree } = getDefaultAddressTreeInfo();

  const addressSeed = deriveAddressSeed(
    [
      new Uint8Array(getUtf8Encoder().encode("multi_wallet")),
      new Uint8Array(getU128Encoder().encode(index)),
    ],
    new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS)
  );
  return createBN254(
    deriveAddress(addressSeed, new PublicKey(tree)).toString(),
    "base58"
  );
}

export async function checkIfSettingsAccountIsCompressed(
  index: bigint | number,
  cachedCompressedAccounts?: Map<string, any>
): Promise<boolean> {
  const address = getCompressedSettingsAddressFromIndex(index);
  const result = await getCompressedAccount(address, cachedCompressedAccounts);
  if (!result?.data?.data) {
    return false;
  }
  const decoded = getCompressedSettingsDecoder().decode(result?.data?.data);
  return decoded.data.__option === "Some";
}

export async function fetchSettingsData(
  index: number | bigint,
  cachedCompressedAccounts?: Map<string, any>
): Promise<CompressedSettingsData> {
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
    return data.data.value;
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
    };
  }
}
