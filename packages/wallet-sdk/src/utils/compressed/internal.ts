import {
  AccountProofInput,
  AddressWithTree,
  BN254,
  CompressedAccount,
  featureFlags,
  getDefaultAddressTreeInfo,
  HashWithTree,
  TreeInfo,
  TreeType,
  ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import { Decoder, getProgramDerivedAddress, getUtf8Encoder } from "@solana/kit";
import BN from "bn.js";
import {
  getCompressedSettingsDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
  SettingsReadonlyArgs,
  ValidityProofArgs,
} from "../../generated";
import { MAX_HOTSPOTS } from "../consts";
import { getLightProtocolRpc } from "../initialize";
import { getCompressedSettingsAddressFromIndex } from "./helper";
import { PackedAccounts } from "./packedAccounts";

export function getNewAddressesParams(
  addresses: { pubkey: BN254; type: "Settings" | "User" }[]
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

export async function getCompressedAccountHashes(
  addresses: { address: BN254; type: "Settings" | "User" }[]
) {
  const compressedAccounts = await Promise.all(
    addresses.map(
      async (x) => await getLightProtocolRpc().getCompressedAccount(x.address)
    )
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
  newAddresses: (AddressWithTree & { type: "User" | "Settings" })[],
  excludedTreeInfo?: TreeInfo[]
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

  const excludedKeys = new Set<string>(
    (excludedTreeInfo ?? []).map((info) =>
      info.treeType === TreeType.StateV1
        ? info.tree.toString()
        : info.queue.toString()
    )
  );

  const stateTreeInfos = await getLightProtocolRpc().getStateTreeInfos();
  const activeInfos = stateTreeInfos.filter((t) => !t.nextTreeInfo);
  const desiredTreeType = featureFlags.isV2()
    ? TreeType.StateV2
    : TreeType.StateV1;
  const filteredInfos = activeInfos.filter(
    (t) => t.treeType === desiredTreeType && t.queue
  );

  const maxCandidates = Math.min(MAX_HOTSPOTS, filteredInfos.length);
  const uniqueCandidates: TreeInfo[] = [];

  for (const info of filteredInfos.slice(0, maxCandidates)) {
    const key =
      info.treeType === TreeType.StateV1
        ? info.tree.toString()
        : info.queue.toString();

    if (!excludedKeys.has(key)) {
      excludedKeys.add(key);
      uniqueCandidates.push(info);
    }

    if (uniqueCandidates.length === newAddresses.length) break;
  }

  if (uniqueCandidates.length < newAddresses.length) {
    throw new Error(
      `Not enough unique state tree infos available: required ${newAddresses.length}, found ${uniqueCandidates.length}`
    );
  }

  const creationArgs = newAddresses.map((addressWithTree, i) => ({
    addressTreeInfo: addressTrees[i],
    outputStateTreeIndex: packedAccounts.packOutputTreeIndex(
      uniqueCandidates[i]
    )!,
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

  const addressTreeInfo = packedAccounts.packTreeInfos(
    accountProofInputs,
    []
  ).stateTrees;

  if (!addressTreeInfo) {
    throw new Error("Unable to parsed data.");
  }

  const mutArgs = hashes.map((x, index) => ({
    data: decoder.decode(x.data!.data),
    accountMeta: {
      treeInfo: addressTreeInfo.packedTreeInfos[index],
      address: new Uint8Array(x.address!),
      outputStateTreeIndex: addressTreeInfo.outputTreeIndex,
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
  index: bigint | number
) {
  let settingsReadonlyArgs: SettingsReadonlyArgs | null = null;
  let proof: ValidityProofWithContext | null = null;
  const packedAccounts = new PackedAccounts();
  if (compressed) {
    await packedAccounts.addSystemAccounts();
    const settingsAddress = await getCompressedSettingsAddressFromIndex(index);
    const settings = (
      await getCompressedAccountHashes([
        { address: settingsAddress, type: "Settings" },
      ])
    )[0];
    proof = await getLightProtocolRpc().getValidityProofV0([settings], []);
    const { tree, queue } = getDefaultAddressTreeInfo();

    settingsReadonlyArgs = {
      lamports: BigInt(settings.lamports.toNumber()),
      data: getCompressedSettingsDecoder().decode(settings.data?.data!),
      addressTreeInfo: {
        rootIndex: proof.rootIndices[0],
        addressMerkleTreePubkeyIndex: packedAccounts.insertOrGet(tree),
        addressQueuePubkeyIndex: packedAccounts.insertOrGet(queue),
      },
      merkleContext: {
        leafIndex: settings.leafIndex,
        merkleTreePubkeyIndex: packedAccounts.insertOrGet(settings.tree),
        queuePubkeyIndex: packedAccounts.insertOrGet(settings.queue),
        proveByIndex: settings.proveByIndex,
      },
    };
  }
  return { settingsReadonlyArgs, proof, packedAccounts };
}
