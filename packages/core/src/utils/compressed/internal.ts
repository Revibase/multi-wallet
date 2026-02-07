import {
  bn,
  CompressedAccountResult,
  CompressedAccountResultV2,
  createCompressedAccountWithMerkleContextLegacy,
  createMerkleContextLegacy,
  encodeBN254toBase58,
  featureFlags,
  getStateTreeInfoByPubkey,
  jsonRpcResultAndContext,
  parseAccountData,
  rpcRequest,
  versionedEndpoint,
  type AccountProofInput,
  type AddressWithTree,
  type BN254,
  type CompressedAccount,
  type CompressedAccountWithMerkleContext,
  type HashWithTree,
  type TreeInfo,
  type ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import { SolanaJSONRPCError } from "@solana/web3.js";
import {
  some,
  type AccountInfoBase,
  type Address,
  type Base64EncodedDataResponse,
  type Decoder,
  type OptionOrNullable,
  type Slot,
} from "gill";
import { create, nullable } from "superstruct";
import { NotFoundError, ValidationError } from "../../errors";
import {
  fetchWhitelistedAddressTree,
  getCompressedSettingsDecoder,
  type CompressedProof,
  type SettingsMutArgs,
  type SettingsReadonlyArgs,
} from "../../generated";
import type { AccountCache } from "../../types";
import {
  getCompressedSettingsAddress,
  getWhitelistedAddressTreesAddress,
} from "../addresses";
import {
  createAccountInfoCacheKey,
  createCompressedAccountCacheKey,
  getCachedOrFetch,
} from "../cache";
import { getLightProtocolRpc, getSolanaRpc } from "../initialize";
import { retryWithBackoff } from "../retry";
import { defaultStateTreeInfos, PackedAccounts } from "./packedAccounts";

export async function fetchCachedCompressedAccount(
  address: BN254,
  cachedAccounts?: AccountCache,
): Promise<CompressedAccount | null> {
  const key = createCompressedAccountCacheKey(address);
  return getCachedOrFetch(cachedAccounts, key, () =>
    getCompressedAccount(address),
  );
}

async function getCompressedAccount(
  address?: BN254,
  hash?: BN254,
): Promise<CompressedAccountWithMerkleContext | null> {
  if (!hash && !address) {
    throw new Error("Either hash or address must be provided");
  }
  if (hash && address) {
    throw new Error("Only one of hash or address must be provided");
  }

  const unsafeRes = await rpcRequest(
    getLightProtocolRpc().compressionApiEndpoint,
    versionedEndpoint("getCompressedAccount"),
    {
      hash: hash ? encodeBN254toBase58(hash) : undefined,
      address: address ? encodeBN254toBase58(address) : undefined,
    },
  );

  let res;
  if (featureFlags.isV2()) {
    res = create(
      unsafeRes,
      jsonRpcResultAndContext(nullable(CompressedAccountResultV2)),
    );
  } else {
    res = create(
      unsafeRes,
      jsonRpcResultAndContext(nullable(CompressedAccountResult)),
    );
  }

  if ("error" in res) {
    throw new SolanaJSONRPCError(
      res.error,
      `failed to get info for compressed account ${hash ? hash.toString() : address ? address.toString() : ""}`,
    );
  }
  if (res.result.value === null) {
    return null;
  }

  const tree = featureFlags.isV2()
    ? (res.result.value as any).merkleContext.tree
    : (res.result.value as any).tree!;
  const stateTreeInfo = getStateTreeInfoByPubkey(defaultStateTreeInfos, tree);
  const item = res.result.value;

  return createCompressedAccountWithMerkleContextLegacy(
    createMerkleContextLegacy(stateTreeInfo, item.hash, item.leafIndex),
    item.owner,
    bn(item.lamports),
    item.data ? parseAccountData(item.data) : undefined,
    item.address || undefined,
  );
}

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

export async function getCompressedAccountHashes(
  addresses: { address: BN254; type: "Settings" | "User" }[],
  cachedAccounts?: AccountCache,
) {
  const compressedAccounts = (
    await Promise.all(
      addresses.map((x) =>
        fetchCachedCompressedAccount(x.address, cachedAccounts),
      ),
    )
  )
    .filter((x) => x !== null)
    .filter((x) => x.data !== null && x.address !== null);

  if (compressedAccounts.length !== addresses.length) {
    throw new NotFoundError(
      "Compressed account",
      `Expected ${addresses.length} accounts but found ${compressedAccounts.length}`,
    );
  }

  return compressedAccounts.map((x, index) => ({
    ...x,
    type: addresses[index].type,
    tree: x.treeInfo.tree,
    queue: x.treeInfo.queue,
  }));
}

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

export async function constructSettingsProofArgs(
  compressed: boolean,
  settings: Address,
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
    const { address } = await getCompressedSettingsAddress(
      settings,
      settingsAddressTreeIndex,
    );
    const settingsAccount = (
      await getCompressedAccountHashes(
        [{ address, type: "Settings" }],
        cachedAccounts,
      )
    )[0];
    if (simulateProof) {
      proof = {
        rootIndices: [0],
        roots: [],
        leafIndices: [settingsAccount.leafIndex],
        leaves: [],
        treeInfos: [settingsAccount.treeInfo],
        proveByIndices: [settingsAccount.proveByIndex],
        compressedProof: {
          a: Array.from(crypto.getRandomValues(new Uint8Array(32))),
          b: Array.from(crypto.getRandomValues(new Uint8Array(32))),
          c: Array.from(crypto.getRandomValues(new Uint8Array(32))),
        },
      };
    } else {
      proof = await getValidityProofWithRetry([settingsAccount], []);
    }

    const stateTreeInfo = packedAccounts.packTreeInfos(
      [
        {
          treeInfo: proof.treeInfos[0],
          rootIndex: proof.rootIndices[0],
          leafIndex: proof.leafIndices[0],
          proveByIndex: proof.proveByIndices[0],
          hash: settingsAccount.hash,
        },
      ],
      [],
    ).stateTrees;

    if (!stateTreeInfo) {
      throw new ValidationError("Unable to parse state tree data");
    }

    settingsReadonlyArgs = {
      accountMeta: {
        address: new Uint8Array(settingsAccount.address!),
        treeInfo: stateTreeInfo.packedTreeInfos[0],
      },
      data: getCompressedSettingsDecoder().decode(settingsAccount.data?.data!),
    };

    settingsMutArgs = {
      accountMeta: {
        address: new Uint8Array(settingsAccount.address!),
        treeInfo: stateTreeInfo.packedTreeInfos[0],
        outputStateTreeIndex: stateTreeInfo.outputTreeIndex,
      },
      data: getCompressedSettingsDecoder().decode(settingsAccount.data?.data!),
    };
  }
  return { settingsReadonlyArgs, proof, packedAccounts, settingsMutArgs };
}

export async function getValidityProofWithRetry(
  hashes?: HashWithTree[] | undefined,
  newAddresses?: AddressWithTree[],
): Promise<ValidityProofWithContext> {
  return retryWithBackoff(() =>
    getLightProtocolRpc().getValidityProofV0(hashes, newAddresses),
  );
}

export async function getNewWhitelistedAddressTreeIndex() {
  const addressTrees = await getCachedWhitelistedAddressTree();
  return addressTrees.length - 1;
}

let cachedWhitelistedAddressTrees: Address[] | undefined = undefined;

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

enum TokenDataVersion {
  V1 = 1,
  V2 = 2,
  ShaFlat = 3,
}

export function getVersionFromDiscriminator(
  discriminator: number[] | undefined,
): number {
  if (!discriminator || discriminator.length < 8) {
    return TokenDataVersion.ShaFlat;
  }
  if (discriminator[0] === 2) {
    return TokenDataVersion.V1;
  }
  const versionByte = discriminator[7];
  if (versionByte === 3) {
    return TokenDataVersion.V2;
  }
  if (versionByte === 4) {
    return TokenDataVersion.ShaFlat;
  }
  return TokenDataVersion.ShaFlat;
}
