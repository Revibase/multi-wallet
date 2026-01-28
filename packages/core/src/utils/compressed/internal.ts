import {
  type AccountProofInput,
  type AddressWithTree,
  type BN254,
  type CompressedAccount,
  type HashWithTree,
  type TreeInfo,
  type ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import {
  some,
  type AccountInfoBase,
  type Address,
  type Base64EncodedDataResponse,
  type Decoder,
  type OptionOrNullable,
  type Slot,
} from "gill";
import { NotFoundError, ValidationError } from "../../errors";
import {
  fetchWhitelistedAddressTree,
  getCompressedSettingsDecoder,
  type CompressedProof,
  type SettingsMutArgs,
  type SettingsReadonlyArgs,
} from "../../generated";
import {
  getCompressedSettingsAddressFromIndex,
  getWhitelistedAddressTreesAddress,
} from "../addresses";
import {
  createAccountInfoCacheKey,
  createCompressedAccountCacheKey,
  getCachedOrFetch,
} from "../cache";
import { getLightProtocolRpc, getSolanaRpc } from "../initialize";
import { retryWithBackoff } from "../retry";
import { PackedAccounts } from "./packedAccounts";

import type { AccountCache } from "../../types";

/**
 * Fetches a compressed account with caching support
 * @param address - Compressed account address (BN254)
 * @param cachedAccounts - Optional cache for account data
 * @returns Compressed account data or null if not found
 */
export async function fetchCachedCompressedAccount(
  address: BN254,
  cachedAccounts?: AccountCache,
): Promise<CompressedAccount | null> {
  const key = createCompressedAccountCacheKey(address);
  return getCachedOrFetch(cachedAccounts, key, () =>
    getLightProtocolRpc().getCompressedAccount(address),
  );
}

/**
 * Fetches account info with caching support
 * @param address - Account address
 * @param cachedAccounts - Optional cache for account data
 * @returns Account info with slot context
 */
export async function fetchCachedAccountInfo(
  address: Address,
  cachedAccounts?: AccountCache,
): Promise<
  Readonly<{
    context: Readonly<{
      slot: Slot;
    }>;
    value:
      | (AccountInfoBase &
          Readonly<{
            data: Base64EncodedDataResponse;
          }>)
      | null;
  }>
> {
  const key = createAccountInfoCacheKey(address);
  return getCachedOrFetch(cachedAccounts, key, () =>
    getSolanaRpc().getAccountInfo(address, { encoding: "base64" }).send(),
  );
}

/**
 * Fetches compressed account hashes and tree information for multiple accounts
 * @param addresses - Array of compressed account addresses with their types
 * @param cachedAccounts - Optional cache for account data
 * @returns Array of account hashes with tree information
 * @throws {NotFoundError} If any account is missing
 */
export async function getCompressedAccountHashes(
  addresses: { address: BN254; type: "Settings" | "User" }[],
  cachedAccounts?: AccountCache,
) {
  const compressedAccounts = await Promise.all(
    addresses.map(async (x) =>
      fetchCachedCompressedAccount(x.address, cachedAccounts),
    ),
  );

  const filtered = compressedAccounts
    .filter((x) => x !== null)
    .filter((x) => x.data !== null && x.address !== null);

  if (filtered.length !== addresses.length) {
    throw new NotFoundError(
      "Compressed account",
      `Expected ${addresses.length} accounts but found ${filtered.length}`,
    );
  }

  return filtered.map((x, index) => ({
    ...x,
    type: addresses[index].type,
    tree: x.treeInfo.tree,
    queue: x.treeInfo.queue,
  }));
}

/**
 * Converts a validity proof to compressed proof arguments format
 * @param validityProof - Validity proof with context, or null
 * @param offset - Starting index for Light CPI accounts
 * @returns Compressed proof arguments with account index offset
 */
export function convertToCompressedProofArgs(
  validityProof: ValidityProofWithContext | null,
  offset: number,
) {
  const proof: OptionOrNullable<CompressedProof> =
    validityProof?.compressedProof
      ? some({
          a: new Uint8Array(validityProof.compressedProof.a),
          b: new Uint8Array(validityProof.compressedProof.b),
          c: new Uint8Array(validityProof.compressedProof.c),
        })
      : null;
  return {
    proof,
    lightCpiAccountsStartIndex: offset,
  };
}

/**
 * Generates initialization arguments for new compressed accounts
 * @param packedAccounts - Packed accounts helper for tree operations
 * @param treeInfos - Tree information from validity proof
 * @param roots - Merkle tree roots
 * @param rootIndices - Root indices in the state tree
 * @param newAddresses - New addresses to initialize with their types
 * @returns Array of initialization arguments, empty if no new addresses
 */
export async function getCompressedAccountInitArgs(
  packedAccounts: PackedAccounts,
  treeInfos: ValidityProofWithContext["treeInfos"],
  roots: ValidityProofWithContext["roots"],
  rootIndices: ValidityProofWithContext["rootIndices"],
  newAddresses: (AddressWithTree & { type: "User" | "Settings" })[],
) {
  if (newAddresses.length === 0) return [];
  const newAddressProofInputs = newAddresses.map((x, index) => ({
    treeInfo: treeInfos[index],
    root: roots[index],
    rootIndex: rootIndices[index],
    address: x.address.toArray(),
  }));

  const { addressTrees } = packedAccounts.packTreeInfos(
    [],
    newAddressProofInputs,
  );
  const outputStateTreeIndex = await packedAccounts.getOutputTreeIndex();

  const creationArgs = newAddresses.map((addressWithTree, i) => ({
    addressTreeInfo: addressTrees[i],
    outputStateTreeIndex,
    address: addressWithTree.address,
    type: addressWithTree.type,
  }));

  return creationArgs;
}

/**
 * Generates mutation arguments for updating compressed accounts
 * @param packedAccounts - Packed accounts helper for tree operations
 * @param treeInfos - Tree information for each account
 * @param leafIndices - Leaf indices in the merkle trees
 * @param rootIndices - Root indices in the state tree
 * @param proveByIndices - Whether to prove by index for each account
 * @param hashes - Account hashes with data and addresses
 * @param decoder - Decoder for account data type T
 * @returns Array of mutation arguments with account metadata
 * @throws {ValidationError} If state tree data cannot be parsed
 */
export function getCompressedAccountMutArgs<T>(
  packedAccounts: PackedAccounts,
  treeInfos: TreeInfo[],
  leafIndices: number[],
  rootIndices: number[],
  proveByIndices: boolean[],
  hashes: (HashWithTree & {
    data: CompressedAccount["data"];
    address: CompressedAccount["address"];
  })[],
  decoder: Decoder<T>,
) {
  const accountProofInputs: AccountProofInput[] = [];
  for (let index = 0; index < treeInfos.length; index++) {
    accountProofInputs.push({
      treeInfo: treeInfos[index],
      rootIndex: rootIndices[index],
      leafIndex: leafIndices[index],
      proveByIndex: proveByIndices[index],
      hash: hashes[index].hash,
    });
  }

  const stateTreeInfo = packedAccounts.packTreeInfos(
    accountProofInputs,
    [],
  ).stateTrees;

  if (!stateTreeInfo) {
    throw new ValidationError("Unable to parse state tree data");
  }

  const mutArgs = hashes.map((x, index) => ({
    data: decoder.decode(x.data!.data),
    accountMeta: {
      treeInfo: stateTreeInfo.packedTreeInfos[index],
      address: new Uint8Array(x.address!),
      outputStateTreeIndex: stateTreeInfo.outputTreeIndex,
    },
  }));

  return mutArgs;
}

/**
 * Constructs proof arguments for settings account operations
 * Handles both compressed and regular settings accounts
 * @param compressed - Whether to use compressed account format
 * @param index - Settings index
 * @param settingsAddressTreeIndex - Optional address tree index
 * @param simulateProof - Whether to use simulated proof (for testing)
 * @param cachedAccounts - Optional cache for account data
 * @returns Proof arguments with settings data and packed accounts
 * @throws {ValidationError} If state tree data cannot be parsed
 */
export async function constructSettingsProofArgs(
  compressed: boolean,
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  simulateProof?: boolean,
  cachedAccounts?: AccountCache,
) {
  let settingsReadonlyArgs: SettingsReadonlyArgs | null = null;
  let settingsMutArgs: SettingsMutArgs | null = null;
  let proof: ValidityProofWithContext | null = null;
  const packedAccounts = new PackedAccounts();
  if (compressed) {
    await packedAccounts.addSystemAccounts();
    const { address } = await getCompressedSettingsAddressFromIndex(
      index,
      settingsAddressTreeIndex,
    );
    const settings = (
      await getCompressedAccountHashes(
        [{ address, type: "Settings" }],
        cachedAccounts,
      )
    )[0];
    if (simulateProof) {
      proof = {
        rootIndices: [0],
        roots: [],
        leafIndices: [settings.leafIndex],
        leaves: [],
        treeInfos: [settings.treeInfo],
        proveByIndices: [settings.proveByIndex],
        compressedProof: {
          a: Array.from(crypto.getRandomValues(new Uint8Array(32))),
          b: Array.from(crypto.getRandomValues(new Uint8Array(32))),
          c: Array.from(crypto.getRandomValues(new Uint8Array(32))),
        },
      };
    } else {
      proof = await getValidityProofWithRetry([settings], []);
    }

    const stateTreeInfo = packedAccounts.packTreeInfos(
      [
        {
          treeInfo: proof.treeInfos[0],
          rootIndex: proof.rootIndices[0],
          leafIndex: proof.leafIndices[0],
          proveByIndex: proof.proveByIndices[0],
          hash: settings.hash,
        },
      ],
      [],
    ).stateTrees;

    if (!stateTreeInfo) {
      throw new ValidationError("Unable to parse state tree data");
    }

    settingsReadonlyArgs = {
      accountMeta: {
        address: new Uint8Array(settings.address!),
        treeInfo: stateTreeInfo.packedTreeInfos[0],
      },
      data: getCompressedSettingsDecoder().decode(settings.data?.data!),
    };

    settingsMutArgs = {
      accountMeta: {
        address: new Uint8Array(settings.address!),
        treeInfo: stateTreeInfo.packedTreeInfos[0],
        outputStateTreeIndex: stateTreeInfo.outputTreeIndex,
      },
      data: getCompressedSettingsDecoder().decode(settings.data?.data!),
    };
  }
  return { settingsReadonlyArgs, proof, packedAccounts, settingsMutArgs };
}

/**
 * Gets validity proof with retry logic using exponential backoff
 * @param hashes - Hash with tree information
 * @param newAddresses - New addresses to include
 * @param maxRetries - Maximum number of retry attempts (default: 10)
 * @param initialDelayMs - Initial delay between retries in milliseconds (default: 400)
 * @returns Validity proof with context
 * @throws {RetryExhaustedError} If all retry attempts are exhausted
 */
export async function getValidityProofWithRetry(
  hashes?: HashWithTree[] | undefined,
  newAddresses?: AddressWithTree[],
): Promise<ValidityProofWithContext> {
  return retryWithBackoff(() =>
    getLightProtocolRpc().getValidityProofV0(hashes, newAddresses),
  );
}
/**
 * Gets the index of the newest whitelisted address tree
 * @returns Index of the last address tree in the whitelist
 */
export async function getNewWhitelistedAddressTreeIndex() {
  const addressTrees = await getCachedWhitelistedAddressTree();
  return addressTrees.length - 1;
}

/** Cached whitelisted address trees to avoid repeated fetches */
let cachedWhitelistedAddressTrees: Address[] | undefined = undefined;

/**
 * Gets the whitelisted address trees, using cache if available
 * @returns Array of whitelisted address tree addresses
 */
export async function getCachedWhitelistedAddressTree() {
  if (!cachedWhitelistedAddressTrees) {
    const { data } = await fetchWhitelistedAddressTree(
      getSolanaRpc(),
      await getWhitelistedAddressTreesAddress(),
    );
    cachedWhitelistedAddressTrees = data.whitelistedAddressTrees;
  }
  return cachedWhitelistedAddressTrees;
}
/**
 * Token data version enum - mirrors Rust TokenDataVersion
 * Used for compressed token account hashing strategy
 */
enum TokenDataVersion {
  /** V1: Poseidon hash with little-endian amount, discriminator [2,0,0,0,0,0,0,0] */
  V1 = 1,
  /** V2: Poseidon hash with big-endian amount, discriminator [0,0,0,0,0,0,0,3] */
  V2 = 2,
  /** ShaFlat: SHA256 hash of borsh-serialized data, discriminator [0,0,0,0,0,0,0,4] */
  ShaFlat = 3,
}

/**
 * Determines token data version from compressed account discriminator
 * @param discriminator - Account discriminator bytes (first 8 bytes)
 * @returns Token data version (defaults to ShaFlat if unrecognized)
 */
export function getVersionFromDiscriminator(
  discriminator: number[] | undefined,
): number {
  if (!discriminator || discriminator.length < 8) {
    // Default to ShaFlat for new accounts without discriminator
    return TokenDataVersion.ShaFlat;
  }

  // V1 has discriminator[0] = 2
  if (discriminator[0] === 2) {
    return TokenDataVersion.V1;
  }

  // V2 and ShaFlat have version in discriminator[7]
  const versionByte = discriminator[7];
  if (versionByte === 3) {
    return TokenDataVersion.V2;
  }
  if (versionByte === 4) {
    return TokenDataVersion.ShaFlat;
  }

  // Default to ShaFlat
  return TokenDataVersion.ShaFlat;
}
