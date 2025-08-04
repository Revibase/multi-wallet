import {
  createBN254,
  deriveAddress,
  deriveAddressSeed,
  getDefaultAddressTreeInfo,
} from "@lightprotocol/stateless.js";
import {
  Address,
  address,
  getAddressEncoder,
  getU128Encoder,
  getUtf8Encoder,
  isAddress,
  none,
  some,
} from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  CompressedSettingsData,
  fetchMaybeSettings,
  getCompressedSettingsDecoder,
  getDelegateDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
} from "../generated";
import { Secp256r1Key } from "../types";
import {
  getLightProtocolRpc,
  getSettingsFromIndex,
  getSolanaRpc,
} from "../utils";

export async function getDelegateAddress(member: Address | Secp256r1Key) {
  const { tree } = getDefaultAddressTreeInfo();
  if (member instanceof Secp256r1Key) {
    const addressSeed = deriveAddressSeed(
      [
        new Uint8Array(getUtf8Encoder().encode("delegate")),
        member.toTruncatedBuffer(),
      ],
      new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS)
    );
    return createBN254(
      deriveAddress(addressSeed, new PublicKey(tree)).toString(),
      "base58"
    );
  } else if (isAddress(member.toString())) {
    const addressSeed = deriveAddressSeed(
      [
        new Uint8Array(getUtf8Encoder().encode("delegate")),
        new Uint8Array(getAddressEncoder().encode(address(member.toString()))),
      ],
      new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS)
    );
    return createBN254(
      deriveAddress(addressSeed, new PublicKey(tree)).toString(),
      "base58"
    );
  } else {
    throw new Error("Unable to parse Public Key");
  }
}

export async function fetchDelegateIndex(
  member: Address | Secp256r1Key
): Promise<bigint> {
  const address = await getDelegateAddress(member);
  const delegate = await getLightProtocolRpc().getCompressedAccount(address);
  if (!delegate?.data?.data) {
    throw Error("Unable to fetch delegate account.");
  }
  const data = getDelegateDecoder().decode(delegate.data.data);
  if (data.index.__option === "None") {
    throw Error("Unable to fetch delegate account.");
  }
  return data.index.value;
}

export async function fetchMaybeDelegateIndex(
  member: Address | Secp256r1Key
): Promise<bigint | null> {
  const address = await getDelegateAddress(member);
  const delegate = await getLightProtocolRpc().getCompressedAccount(address);
  if (!delegate?.data?.data) {
    return null;
  }
  const data = getDelegateDecoder().decode(delegate.data.data);
  if (data.index.__option === "None") {
    return null;
  }
  return data.index.value;
}

export async function getCompressedSettingsAddressFromIndex(
  index: number | bigint
) {
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
  index: bigint | number
): Promise<boolean> {
  const address = await getCompressedSettingsAddressFromIndex(index);
  const result = await getLightProtocolRpc().getCompressedAccount(address);
  if (!result?.data?.data) {
    return false;
  }
  const decoded = getCompressedSettingsDecoder().decode(result?.data?.data);
  return decoded.data.__option === "Some";
}

type SettingsData = CompressedSettingsData;
export async function fetchSettingsData(
  index: number | bigint
): Promise<SettingsData> {
  const result = await fetchMaybeSettings(
    getSolanaRpc(),
    await getSettingsFromIndex(index)
  );
  if (result.exists) {
    return {
      ...result.data,
      members: result.data.members
        .slice(0, result.data.membersLen)
        .map((x) => ({
          ...x,
          domainConfig:
            x.domainConfig.toString() === PublicKey.default.toString()
              ? none()
              : some(x.domainConfig),
        })),
    };
  } else {
    const address = await getCompressedSettingsAddressFromIndex(index);
    const result = await getLightProtocolRpc().getCompressedAccount(address);
    if (!result?.data?.data) {
      throw new Error("Settings account does not exist.");
    }
    const data = getCompressedSettingsDecoder().decode(result.data.data);
    if (data.data.__option === "None") {
      throw new Error("Settings account does not exist.");
    }
    return data.data.value;
  }
}
