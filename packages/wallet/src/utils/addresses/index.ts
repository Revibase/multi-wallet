import {
  createBN254,
  deriveAddress,
  deriveAddressSeed,
  getDefaultAddressTreeInfo,
} from "@lightprotocol/stateless.js";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU128Encoder,
  getU8Encoder,
  getUtf8Encoder,
  type Address,
} from "gill";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../../generated";
import { Secp256r1Key } from "../../types";
import { ADDRESS_TREE_VERSION } from "../consts";

export async function getDomainConfigAddress({
  rpIdHash,
  rpId,
}: {
  rpIdHash?: Uint8Array;
  rpId?: string;
}) {
  if (!rpIdHash) {
    if (rpId) {
      rpIdHash = sha256(new TextEncoder().encode(rpId));
    } else {
      throw new Error("RpId not found.");
    }
  }
  if (!rpIdHash) {
    throw new Error("RpIdHash not found.");
  }
  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("domain_config"), rpIdHash],
  });

  return domainConfig;
}

export async function getGlobalCounterAddress() {
  const [globalCounter] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("global_counter")],
  });

  return globalCounter;
}
export async function getTransactionBufferAddress(
  settings: Address,
  creator: Address | Secp256r1Key,
  buffer_index: number
) {
  if (buffer_index > 255) {
    throw new Error("Index cannot be greater than 255.");
  }
  const [transactionBuffer] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("multi_wallet"),
      getAddressEncoder().encode(settings),
      getUtf8Encoder().encode("transaction_buffer"),
      creator instanceof Secp256r1Key
        ? creator.toTruncatedBuffer()
        : getAddressEncoder().encode(creator),
      getU8Encoder().encode(buffer_index),
    ],
  });

  return transactionBuffer;
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
