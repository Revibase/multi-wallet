import { type TransactionSigner } from "gill";
import {
  getCreateCompressedWalletInstructionAsync,
  getUserDecoder,
  UserRole,
  type User,
} from "../../generated";
import {
  getCompressedSettingsAddress,
  getSettingsFromIndex,
  getUserAccountAddress,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewWhitelistedAddressTreeIndex,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

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
              userAddressTreeIndex,
            )
          ).address,
          type: "User" as const,
        },
      ],
      cachedAccounts,
    )),
  );
  const settingsAddressTreeIndex = await getNewWhitelistedAddressTreeIndex();
  const { address: settingsAddress, addressTree } =
    await getCompressedSettingsAddress(
      await getSettingsFromIndex(index),
      settingsAddressTreeIndex,
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
    newAddressParams,
  );

  const userMutArgs = getCompressedAccountMutArgs<User>(
    packedAccounts,
    proof.treeInfos.slice(0, hashesWithTreeEndIndex),
    proof.leafIndices.slice(0, hashesWithTreeEndIndex),
    proof.rootIndices.slice(0, hashesWithTreeEndIndex),
    proof.proveByIndices.slice(0, hashesWithTreeEndIndex),
    hashesWithTree.filter((x) => x.type === "User"),
    getUserDecoder(),
  )[0];

  const initArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos.slice(hashesWithTreeEndIndex),
    proof.roots.slice(hashesWithTreeEndIndex),
    proof.rootIndices.slice(hashesWithTreeEndIndex),
    newAddressParams,
  );

  const settingsCreationArgs =
    initArgs.find((x) => x.type === "Settings") ?? null;

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  if (!settingsCreationArgs) {
    throw new Error("Settings creation args is missing.");
  }

  return await getCreateCompressedWalletInstructionAsync({
    settingsIndex: index,
    payer,
    initialMember,
    userArgs:
      userMutArgs.data.role === UserRole.Member
        ? { __kind: "Mutate", fields: [userMutArgs] }
        : { __kind: "Read", fields: [userMutArgs] },
    compressedProofArgs,
    settingsCreation: settingsCreationArgs,
    remainingAccounts,
  });
}
