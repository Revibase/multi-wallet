import {
  type AccountProofInput,
  type AddressWithTree,
  type BN254,
  type CompressedAccount,
  type HashWithTree,
  type TreeInfo,
  type ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import BN from "bn.js";
import { some, type Address, type Decoder, type OptionOrNullable } from "gill";
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
import { getLightProtocolRpc, getSolanaRpc } from "../initialize";
import { fetchCompressedAccount } from "./helper";
import { PackedAccounts } from "./packedAccounts";

export async function getCompressedAccount(
  address: BN,
  cachedAccounts?: Map<string, any>
): Promise<CompressedAccount | null> {
  let result = cachedAccounts?.get(address.toString());
  if (result) {
    return result;
  } else {
    const compressedAccount = await fetchCompressedAccount(address);
    if (compressedAccount) {
      cachedAccounts?.set(address.toString(), compressedAccount);
    }
    return compressedAccount;
  }
}

export async function getCompressedAccountHashes(
  addresses: { address: BN254; type: "Settings" | "User" }[],
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
  treeInfos: TreeInfo[],
  roots: BN[],
  rootIndices: number[],
  newAddresses: (AddressWithTree & { type: "User" | "Settings" })[]
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

export async function constructSettingsProofArgs(
  compressed: boolean,
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  simulateProof?: boolean,
  cachedAccounts?: Map<string, any>
) {
  let settingsReadonlyArgs: SettingsReadonlyArgs | null = null;
  let settingsMutArgs: SettingsMutArgs | null = null;
  let proof: ValidityProofWithContext | null = null;
  const packedAccounts = new PackedAccounts();
  if (compressed) {
    await packedAccounts.addSystemAccounts();
    const { address } = await getCompressedSettingsAddressFromIndex(
      index,
      settingsAddressTreeIndex
    );
    const settings = (
      await getCompressedAccountHashes(
        [{ address, type: "Settings" }],
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
export async function getNewWhitelistedAddressTreeIndex() {
  const addressTrees = await getCachedWhitelistedAddressTree();
  return addressTrees.length - 1;
}

let cachedWhitelistedAddressTrees: Address[] | undefined = undefined;
export async function getCachedWhitelistedAddressTree() {
  if (!cachedWhitelistedAddressTrees) {
    const { data } = await fetchWhitelistedAddressTree(
      getSolanaRpc(),
      await getWhitelistedAddressTreesAddress()
    );
    cachedWhitelistedAddressTrees = data.whitelistedAddressTrees;
  }
  return cachedWhitelistedAddressTrees;
}
