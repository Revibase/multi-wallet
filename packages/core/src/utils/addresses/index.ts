import {
  createBN254,
  deriveAddressSeedV2,
  deriveAddressV2,
} from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU128Encoder,
  getU8Encoder,
  getUtf8Encoder,
  type Address,
} from "gill";
import { MAX_TRANSACTION_BUFFER_INDEX } from "../../constants";
import { ValidationError } from "../../errors";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../../generated";
import { Secp256r1Key } from "../../types";
import { getWhitelistedAddressTreeFromIndex } from "../compressed/helper";
import { sha256 } from "../crypto";
import { requireInRange } from "../validation";

/**
 * Derives a compressed settings account address from an index
 * @param index - Settings index
 * @param settingsAddressTreeIndex - Address tree index (default: 0)
 * @returns Compressed account address and associated address tree
 */
export async function getCompressedSettingsAddressFromIndex(
  index: number | bigint,
  settingsAddressTreeIndex = 0,
) {
  const addressTree = await getWhitelistedAddressTreeFromIndex(
    settingsAddressTreeIndex,
  );
  const addressSeed = deriveAddressSeedV2([
    getUtf8Encoder().encode("multi_wallet") as Uint8Array,
    getU128Encoder().encode(index) as Uint8Array,
  ]);
  return {
    address: createBN254(
      deriveAddressV2(
        addressSeed,
        new PublicKey(addressTree),
        new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS),
      ).toString(),
      "base58",
    ),
    addressTree: new PublicKey(addressTree),
  };
}
/**
 * Derives a user account address from a member key
 * @param member - Member address or Secp256r1Key
 * @param userAddressTreeIndex - Address tree index (default: 0)
 * @returns Compressed user account address and associated address tree
 */
export async function getUserAccountAddress(
  member: Address | Secp256r1Key,
  userAddressTreeIndex = 0,
) {
  const addressTree =
    await getWhitelistedAddressTreeFromIndex(userAddressTreeIndex);
  const addressSeed = deriveAddressSeedV2([
    getUtf8Encoder().encode("user") as Uint8Array,
    member instanceof Secp256r1Key
      ? member.toTruncatedBuffer()
      : (getAddressEncoder().encode(member) as Uint8Array),
  ]);

  return {
    address: createBN254(
      deriveAddressV2(
        addressSeed,
        new PublicKey(addressTree),
        new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS.toString()),
      ).toString(),
      "base58",
    ),
    addressTree: new PublicKey(addressTree),
  };
}

/**
 * Derives a domain configuration address from RP ID hash or RP ID string
 * @param params - Either rpIdHash (32-byte hash) or rpId (string to hash)
 * @returns Domain configuration account address
 * @throws {ValidationError} If neither rpIdHash nor rpId is provided
 */
export async function getDomainConfigAddress({
  rpIdHash,
  rpId,
}: {
  rpIdHash?: Uint8Array<ArrayBuffer>;
  rpId?: string;
}) {
  if (!rpIdHash) {
    if (rpId) {
      rpIdHash = await sha256(
        getUtf8Encoder().encode(rpId) as Uint8Array<ArrayBuffer>,
      );
    } else {
      throw new ValidationError("Either rpId or rpIdHash must be provided");
    }
  }
  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("domain_config"), rpIdHash],
  });

  return domainConfig;
}

/**
 * Derives the global counter account address
 * @returns Global counter account address
 */
export async function getGlobalCounterAddress() {
  const [globalCounter] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("global_counter")],
  });

  return globalCounter;
}

/**
 * Derives the whitelisted address trees account address
 * @returns Whitelisted address trees account address
 */
export async function getWhitelistedAddressTreesAddress() {
  const [whitelistedAddressTrees] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("whitelisted_address_trees")],
  });

  return whitelistedAddressTrees;
}

/**
 * Gets transaction buffer address from settings, creator, and index
 * @param settings - Settings address
 * @param creator - Creator address or Secp256r1Key
 * @param buffer_index - Buffer index (0-255)
 * @returns Transaction buffer address
 * @throws {ValidationError} If buffer_index exceeds maximum
 */
export async function getTransactionBufferAddress(
  settings: Address,
  creator: Address | Secp256r1Key,
  buffer_index: number,
): Promise<Address> {
  requireInRange(buffer_index, 0, MAX_TRANSACTION_BUFFER_INDEX, "buffer_index");
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
/**
 * Derives a wallet (vault) address from a settings address
 * @param settings - Settings account address
 * @returns Wallet account address
 */
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
/**
 * Derives a settings account address from an index
 * @param index - Settings index
 * @returns Settings account address
 */
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

/**
 * Derives a wallet address from a settings index
 * @param index - Settings index
 * @returns Wallet account address
 */
export async function getWalletAddressFromIndex(index: number | bigint) {
  const settings = await getSettingsFromIndex(index);
  const address = await getWalletAddressFromSettings(settings);
  return address;
}

/**
 * Derives the Light CPI signer account address
 * @returns Light CPI signer account address
 */
export async function getLightCpiSigner() {
  const [lightCpiSigner] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("cpi_authority")],
  });
  return lightCpiSigner;
}
