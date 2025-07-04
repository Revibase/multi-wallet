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
} from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  Delegate,
  fetchSettings,
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

export async function fetchDelegate(
  member: Address | Secp256r1Key
): Promise<Delegate> {
  const address = await getDelegateAddress(member);
  const delegate = await getLightProtocolRpc().getCompressedAccount(address);
  if (!delegate?.data?.data) {
    throw Error("Unable to fetch delegate account.");
  }
  return getDelegateDecoder().decode(delegate.data.data);
}

export async function fetchMaybeDelegate(
  member: Address | Secp256r1Key
): Promise<Delegate | null> {
  const address = await getDelegateAddress(member);
  const delegate = await getLightProtocolRpc().getCompressedAccount(address);
  if (!delegate?.data?.data) {
    return null;
  }
  return getDelegateDecoder().decode(delegate.data.data);
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
) {
  const address = await getCompressedSettingsAddressFromIndex(index);
  const result = await getLightProtocolRpc().getCompressedAccount(address);
  return !!result?.data;
}

export async function fetchSettingsData(index: number | bigint) {
  const address = await getCompressedSettingsAddressFromIndex(index);
  const result = await getLightProtocolRpc().getCompressedAccount(address);

  if (result?.data?.data) {
    return getCompressedSettingsDecoder().decode(result.data.data);
  } else {
    const result = await fetchSettings(
      getSolanaRpc(),
      await getSettingsFromIndex(index)
    );
    return result.data;
  }
}
