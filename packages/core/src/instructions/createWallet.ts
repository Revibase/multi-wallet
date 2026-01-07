import { type Instruction, type TransactionSigner } from "gill";
import {
  getCreateMultiWalletCompressedInstructionAsync,
  getUserDecoder,
  type User,
} from "../generated";
import {
  getCompressedSettingsAddressFromIndex,
  getUserAccountAddress,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewWhitelistedAddressTreeIndex,
  getValidityProofWithRetry,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";

type CreateWalletArgs = {
  index: number | bigint;
  payer: TransactionSigner;
  cachedAccounts?: Map<string, any>;
  initialMember: TransactionSigner;
  userAddressTreeIndex?: number;
};
export async function createWallet({
  index,
  payer,
  initialMember,
  userAddressTreeIndex,
  cachedAccounts,
}: CreateWalletArgs) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const newAddressParams = [];
  const hashesWithTree = [];

  hashesWithTree.push(
    ...(await getCompressedAccountHashes(
      [
        {
          address: (
            await getUserAccountAddress(
              initialMember.address,
              userAddressTreeIndex
            )
          ).address,
          type: "User" as const,
        },
      ],
      cachedAccounts
    ))
  );
  const settingsAddressTreeIndex = await getNewWhitelistedAddressTreeIndex();
  const { address: settingsAddress, addressTree } =
    await getCompressedSettingsAddressFromIndex(
      index,
      settingsAddressTreeIndex
    );
  newAddressParams.push({
    address: settingsAddress,
    queue: addressTree,
    tree: addressTree,
    type: "Settings" as const,
  });

  const hashesWithTreeEndIndex = hashesWithTree.length;

  const proof = await getValidityProofWithRetry(
    hashesWithTree,
    newAddressParams
  );

  const userMutArgs = getCompressedAccountMutArgs<User>(
    packedAccounts,
    proof.treeInfos.slice(0, hashesWithTreeEndIndex),
    proof.leafIndices.slice(0, hashesWithTreeEndIndex),
    proof.rootIndices.slice(0, hashesWithTreeEndIndex),
    proof.proveByIndices.slice(0, hashesWithTreeEndIndex),
    hashesWithTree.filter((x) => x.type === "User"),
    getUserDecoder()
  )[0];

  const initArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos.slice(hashesWithTreeEndIndex),
    proof.roots.slice(hashesWithTreeEndIndex),
    proof.rootIndices.slice(hashesWithTreeEndIndex),
    newAddressParams
  );

  const settingsCreationArgs =
    initArgs.find((x) => x.type === "Settings") ?? null;

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);
  const instructions: Instruction[] = [];

  if (!settingsCreationArgs) {
    throw new Error("Settings creation args is missing.");
  }

  instructions.push(
    await getCreateMultiWalletCompressedInstructionAsync({
      settingsIndex: index,
      payer,
      initialMember,
      userReadonlyArgs: userMutArgs,
      compressedProofArgs,
      settingsCreation: settingsCreationArgs,
      remainingAccounts,
    })
  );

  return instructions;
}
