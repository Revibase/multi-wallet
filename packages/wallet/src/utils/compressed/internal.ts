import {
  type AccountProofInput,
  type AddressWithTree,
  type BN254,
  type CompressedAccount,
  cpiContext2Pubkey,
  cpiContextPubkey,
  featureFlags,
  getDefaultAddressTreeInfo,
  type HashWithTree,
  isLocalTest,
  merkleTree2Pubkey,
  merkletreePubkey,
  nullifierQueue2Pubkey,
  nullifierQueuePubkey,
  type TreeInfo,
  TreeType,
  type ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { type Decoder, getProgramDerivedAddress, getUtf8Encoder } from "gill";
import {
  getCompressedSettingsDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
  type SettingsReadonlyArgs,
  type ValidityProofArgs,
} from "../../generated";
import { getLightProtocolRpc, getSolanaRpcEndpoint } from "../initialize";
import { getCompressedSettingsAddressFromIndex } from "./helper";
import { PackedAccounts } from "./packedAccounts";

export function getNewAddressesParams(
  addresses: { pubkey: BN254; type: "Settings" | "Delegate" }[]
) {
  const { tree, queue } = getDefaultAddressTreeInfo();

  const newAddresses = addresses.map((x) => ({
    type: x.type,
    address: x.pubkey,
    tree,
    queue,
  }));
  return newAddresses;
}

export async function getCompressedAccount(
  address: BN,
  cachedAccounts?: Map<string, any>
): Promise<CompressedAccount | null> {
  let result = cachedAccounts?.get(address.toString());
  if (result) {
    return result;
  } else {
    const compressedAccount =
      await getLightProtocolRpc().getCompressedAccount(address);
    if (compressedAccount) {
      cachedAccounts?.set(address.toString(), compressedAccount);
    }
    return compressedAccount;
  }
}

export async function getCompressedAccountHashes(
  addresses: { address: BN254; type: "Settings" | "Delegate" }[],
  cachedAccounts?: Map<string, any>
) {
  const compressedAccounts = await Promise.all(
    addresses.map(async (x) => getCompressedAccount(x.address, cachedAccounts))
  );

  const filtered = compressedAccounts
    .filter((x) => x !== null)
    .filter((x) => x.data !== null && x.address !== null);

  if (filtered.length !== addresses.length) {
    throw new Error("Unable to find compressed account.");
  }

  return filtered.map((x, index) => ({
    ...x,
    type: addresses[index].type,
    tree: x.treeInfo.tree,
    queue: x.treeInfo.queue,
  }));
}

export function convertToCompressedProofArgs(
  validityProof: ValidityProofWithContext | null,
  offset: number
) {
  const proof: ValidityProofArgs = [
    validityProof?.compressedProof
      ? {
          a: new Uint8Array(validityProof.compressedProof.a),
          b: new Uint8Array(validityProof.compressedProof.b),
          c: new Uint8Array(validityProof.compressedProof.c),
        }
      : null,
  ];
  return { proof, lightCpiAccountsStartIndex: offset };
}

export async function getCompressedAccountInitArgs(
  packedAccounts: PackedAccounts,
  treeInfos: TreeInfo[],
  roots: BN[],
  rootIndices: number[],
  newAddresses: (AddressWithTree & { type: "Delegate" | "Settings" })[]
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
    newAddressProofInputs
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
  hashes: (HashWithTree & CompressedAccount)[],
  decoder: Decoder<T>
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
    []
  ).stateTrees;

  if (!stateTreeInfo) {
    throw new Error("Unable to parsed data.");
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

export async function getLightCpiSigner() {
  const [lightCpiSigner] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("cpi_authority")],
  });
  return lightCpiSigner;
}

export async function constructSettingsProofArgs(
  compressed: boolean,
  index: bigint | number,
  simulateProof?: boolean,
  cachedAccounts?: Map<string, any>
) {
  let settingsReadonlyArgs: SettingsReadonlyArgs | null = null;
  let proof: ValidityProofWithContext | null = null;
  const packedAccounts = new PackedAccounts();
  if (compressed) {
    await packedAccounts.addSystemAccounts();
    const settingsAddress = getCompressedSettingsAddressFromIndex(index);
    const settings = (
      await getCompressedAccountHashes(
        [{ address: settingsAddress, type: "Settings" }],
        cachedAccounts
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
      []
    ).stateTrees;

    if (!stateTreeInfo) {
      throw new Error("Unable to parsed data.");
    }

    settingsReadonlyArgs = {
      accountMeta: {
        address: new Uint8Array(settings.address!),
        treeInfo: stateTreeInfo.packedTreeInfos[0],
        outputStateTreeIndex: stateTreeInfo.outputTreeIndex,
      },
      data: getCompressedSettingsDecoder().decode(settings.data?.data!),
    };
  }
  return { settingsReadonlyArgs, proof, packedAccounts };
}

export async function getValidityProofWithRetry(
  hashes?: HashWithTree[] | undefined,
  newAddresses?: AddressWithTree[],
  retry = 10,
  delay = 400
) {
  let attempt = 1;
  while (attempt < retry) {
    try {
      const proof = await getLightProtocolRpc().getValidityProofV0(
        hashes,
        newAddresses
      );
      return proof;
    } catch (error) {
      console.error(`Attempt ${attempt}, Get Validity Proof failed. ${error}`);
      attempt++;
      if (attempt >= retry) {
        throw new Error(
          `Failed to get validity proof after ${retry} attempts: ${error}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed to get validity proof after ${retry} attempts`);
}

// V2 testing - State Trees (5 triples)
const batchMerkleTree1 = "bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU";
const batchQueue1 = "oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto";
const batchCpiContext1 = "cpi15BoVPKgEPw5o8wc2T816GE7b378nMXnhH3Xbq4y";

const batchMerkleTree2 = "bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi";
const batchQueue2 = "oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg";
const batchCpiContext2 = "cpi2yGapXUR3As5SjnHBAVvmApNiLsbeZpF3euWnW6B";

const batchMerkleTree3 = "bmt3ccLd4bqSVZVeCJnH1F6C8jNygAhaDfxDwePyyGb";
const batchQueue3 = "oq3AxjekBWgo64gpauB6QtuZNesuv19xrhaC1ZM1THQ";
const batchCpiContext3 = "cpi3mbwMpSX8FAGMZVP85AwxqCaQMfEk9Em1v8QK9Rf";

const batchMerkleTree4 = "bmt4d3p1a4YQgk9PeZv5s4DBUmbF5NxqYpk9HGjQsd8";
const batchQueue4 = "oq4ypwvVGzCUMoiKKHWh4S1SgZJ9vCvKpcz6RT6A8dq";
const batchCpiContext4 = "cpi4yyPDc4bCgHAnsenunGA8Y77j3XEDyjgfyCKgcoc";

const batchMerkleTree5 = "bmt5yU97jC88YXTuSukYHa8Z5Bi2ZDUtmzfkDTA2mG2";
const batchQueue5 = "oq5oh5ZR3yGomuQgFduNDzjtGvVWfDRGLuDVjv9a96P";
const batchCpiContext5 = "cpi5ZTjdgYpZ1Xr7B1cMLLUE81oTtJbNNAyKary2nV6";

// V2 Address Trees
const batchAddressTree = "amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx"; // v2 address tree (queue is part of the tree account)
const testBatchAddressTree = "EzKE84aVTkCUhDHLELqyJaq1Y7UVVmqxXqZjVHwHY3rK"; // v2 address tree (queue is part of the tree account)

/**
 * @internal
 */
const localTestActiveStateTreeInfos = (): TreeInfo[] => {
  return [
    {
      tree: new PublicKey(merkletreePubkey),
      queue: new PublicKey(nullifierQueuePubkey),
      cpiContext: new PublicKey(cpiContextPubkey),
      treeType: TreeType.StateV1,
      nextTreeInfo: null,
    },
    {
      tree: new PublicKey(merkleTree2Pubkey),
      queue: new PublicKey(nullifierQueue2Pubkey),
      cpiContext: new PublicKey(cpiContext2Pubkey),
      treeType: TreeType.StateV1,
      nextTreeInfo: null,
    },
    {
      tree: new PublicKey(batchMerkleTree1),
      queue: new PublicKey(batchQueue1),
      cpiContext: new PublicKey(batchCpiContext1),
      treeType: TreeType.StateV2,
      nextTreeInfo: null,
    },
    {
      tree: new PublicKey(batchMerkleTree2),
      queue: new PublicKey(batchQueue2),
      cpiContext: new PublicKey(batchCpiContext2),
      treeType: TreeType.StateV2,
      nextTreeInfo: null,
    },
    {
      tree: new PublicKey(batchMerkleTree3),
      queue: new PublicKey(batchQueue3),
      cpiContext: new PublicKey(batchCpiContext3),
      treeType: TreeType.StateV2,
      nextTreeInfo: null,
    },
    {
      tree: new PublicKey(batchMerkleTree4),
      queue: new PublicKey(batchQueue4),
      cpiContext: new PublicKey(batchCpiContext4),
      treeType: TreeType.StateV2,
      nextTreeInfo: null,
    },
    {
      tree: new PublicKey(batchMerkleTree5),
      queue: new PublicKey(batchQueue5),
      cpiContext: new PublicKey(batchCpiContext5),
      treeType: TreeType.StateV2,
      nextTreeInfo: null,
    },
    {
      tree: new PublicKey(batchAddressTree),
      queue: new PublicKey(batchAddressTree), // v2 address queue is part of the tree account.
      cpiContext: PublicKey.default,
      treeType: TreeType.AddressV2,
      nextTreeInfo: null,
    },
    {
      tree: new PublicKey(testBatchAddressTree),
      queue: new PublicKey(testBatchAddressTree), // v2 address queue is part of the tree account.
      cpiContext: PublicKey.default,
      treeType: TreeType.AddressV2,
      nextTreeInfo: null,
    },
  ].filter((info) =>
    featureFlags.isV2() ? true : info.treeType === TreeType.StateV1
  );
};

export async function getInternalStateTrees() {
  const stateTreeInfos =
    getSolanaRpcEndpoint().includes("devnet") ||
    isLocalTest(getSolanaRpcEndpoint())
      ? localTestActiveStateTreeInfos()
      : await getLightProtocolRpc().getStateTreeInfos();
  return stateTreeInfos;
}
