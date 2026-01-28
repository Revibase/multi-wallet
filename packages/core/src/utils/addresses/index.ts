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

export async function getGlobalCounterAddress() {
  const [globalCounter] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("global_counter")],
  });

  return globalCounter;
}

export async function getWhitelistedAddressTreesAddress() {
  const [whitelistedAddressTrees] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("whitelisted_address_trees")],
  });

  return whitelistedAddressTrees;
}

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

export async function getLightCpiSigner() {
  const [lightCpiSigner] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("cpi_authority")],
  });
  return lightCpiSigner;
}
