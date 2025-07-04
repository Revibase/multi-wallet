import {
  AccountProofInput,
  AddressWithTree,
  BN254,
  CompressedAccount,
  getDefaultAddressTreeInfo,
  HashWithTree,
  selectStateTreeInfo,
  TreeInfo,
  TreeType,
  ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import {
  address,
  Decoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  none,
  some,
} from "@solana/kit";
import BN from "bn.js";
import {
  MULTI_WALLET_PROGRAM_ADDRESS,
  SettingsProofArgs,
  ValidityProofArgs,
} from "../generated";
import { getLightProtocolRpc } from "../utils";
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

export async function getCompressedAccountHashes(
  addresses: { pubkey: BN254; type: "Settings" | "Delegate" }[]
) {
  const compressedAccounts = await Promise.all(
    addresses.map(
      async (x) => await getLightProtocolRpc().getCompressedAccount(x.pubkey)
    )
  );
  if (compressedAccounts.length === 0) {
    throw new Error("Unable to find compressed account.");
  }
  const filtered = compressedAccounts.filter((x) => x !== null);

  if (filtered.length !== compressedAccounts.length) {
    throw new Error("Unable to find compressed account.");
  }

  return filtered.map((x, index) => ({
    ...x,
    type: addresses[index].type,
    tree: x!.treeInfo.tree,
    queue: x!.treeInfo.queue,
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
  newAddresses: (AddressWithTree & { type: "Delegate" | "Settings" })[],
  excludedTreeInfo?: TreeInfo[]
) {
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

  const existingTreeInfos = new Set<string>(
    excludedTreeInfo?.map((x) =>
      x.treeType === TreeType.StateV1 ? x.tree.toString() : x.queue.toString()
    )
  );
  const stateTreeInfos = await getLightProtocolRpc().getStateTreeInfos();

  const creationArgs = [];
  for (let i = 0; i < newAddresses.length; i++) {
    const tried = new Set<string>();
    let outputStateTreeIndex: number | undefined = undefined;
    while (tried.size < stateTreeInfos.length) {
      const candidate = selectStateTreeInfo(stateTreeInfos);
      const candidateString =
        candidate.treeType === TreeType.StateV1
          ? candidate.tree.toString()
          : candidate.queue.toString();
      if (
        existingTreeInfos.has(candidateString) ||
        tried.has(candidateString)
      ) {
        tried.add(candidateString);
        continue;
      }

      outputStateTreeIndex = packedAccounts.packOutputTreeIndex(candidate);
      existingTreeInfos.add(candidateString);
      break;
    }

    if (!outputStateTreeIndex) {
      throw new Error(
        `Unable to find unique state tree info for new address at index ${i}`
      );
    }

    creationArgs.push({
      addressTreeInfo: addressTrees[i],
      outputStateTreeIndex,
      address: newAddresses[i].address,
      type: newAddresses[i].type,
    });
  }

  return creationArgs;
}

export async function getCompressedAccountMutArgs<T>(
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

export async function getCompressedAccountCloseArgs<T>(
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

  const closeArgs = hashes.map((x, index) => ({
    data: decoder.decode(x.data!.data),
    accountMeta: {
      treeInfo: addressTreeInfo.packedTreeInfos[index],
      address: new Uint8Array(x.address!),
    },
  }));

  return closeArgs;
}

export async function getLightCpiSigner() {
  const [lightCpiSigner] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("cpi_authority")],
  });
  return lightCpiSigner;
}
export async function constructSettingsProofArgs(
  packedAccounts: PackedAccounts,
  compressed: boolean,
  index: bigint | number
) {
  let settingsProofArgs: SettingsProofArgs | null = null;
  let proof: ValidityProofWithContext | null = null;
  if (compressed) {
    await packedAccounts.addSystemAccounts();

    const settingsAddress = await getCompressedSettingsAddressFromIndex(index);
    const settings = (
      await getCompressedAccountHashes([
        { pubkey: settingsAddress, type: "Settings" },
      ])
    )[0];

    proof = await getLightProtocolRpc().getValidityProofV0([settings], []);

    settingsProofArgs = {
      rootIndex: proof.rootIndices[0],
      account: {
        address: settings.address
          ? some(new Uint8Array(settings.address))
          : none(),
        data: settings.data
          ? some({
              data: new Uint8Array(settings.data.data),
              discriminator: new Uint8Array(settings.data.discriminator),
              dataHash: new Uint8Array(settings.data.dataHash),
            })
          : none(),
        lamports: BigInt(settings.lamports.toNumber()),
        owner: address(settings.owner.toString()),
      },
      merkleContext: {
        leafIndex: proof.leafIndices[0],
        merkleTreePubkeyIndex: packedAccounts.insertOrGet(
          proof.treeInfos[0].tree
        ),
        queuePubkeyIndex: packedAccounts.insertOrGet(proof.treeInfos[0].queue),
        proveByIndex: proof.proveByIndices[0],
      },
    };
  }
  return { settingsProofArgs, proof };
}
