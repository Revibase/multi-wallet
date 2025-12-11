import { AccountRole, type Instruction, type TransactionSigner } from "gill";
import {
  getCreateMultiWalletCompressedInstructionAsync,
  getUserDecoder,
  UserRole,
  type User,
} from "../generated";
import { SignedSecp256r1Key } from "../types";
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
import { extractSecp256r1VerificationArgs } from "../utils/transaction/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "./secp256r1Verify";

type CreateWalletArgs = {
  index: number | bigint;
  payer: TransactionSigner;
  cachedAccounts?: Map<string, any>;
  initialMember: TransactionSigner | SignedSecp256r1Key;
  userAddressTreeIndex?: number;
};
export async function createWallet({
  index,
  payer,
  initialMember,
  userAddressTreeIndex,
  cachedAccounts,
}: CreateWalletArgs) {
  const { domainConfig, verifyArgs, message, signature, publicKey } =
    extractSecp256r1VerificationArgs(initialMember);

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  if (message && signature && publicKey) {
    secp256r1VerifyInput.push({
      message,
      signature,
      publicKey,
    });
  }

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
              "address" in initialMember
                ? initialMember.address
                : initialMember,
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

  if (domainConfig) {
    packedAccounts.addPreAccounts([
      { address: domainConfig, role: AccountRole.READONLY },
    ]);
  } else if ("address" in initialMember) {
    packedAccounts.addPreAccounts([
      {
        address: initialMember.address,
        role: AccountRole.READONLY_SIGNER,
        signer: initialMember,
      },
    ]);
  }

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);
  const instructions: Instruction[] = [];

  if (!settingsCreationArgs) {
    throw new Error("Settings creation args is missing.");
  }

  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  instructions.push(
    await getCreateMultiWalletCompressedInstructionAsync({
      settingsIndex: index,
      payer: payer,
      initialMember:
        initialMember instanceof SignedSecp256r1Key ? undefined : initialMember,
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      userArgs:
        userMutArgs.data.role === UserRole.PermanentMember
          ? { __kind: "Mutate", fields: [userMutArgs] }
          : { __kind: "Read", fields: [userMutArgs] },
      compressedProofArgs,
      settingsCreation: settingsCreationArgs,
      remainingAccounts,
    })
  );

  return instructions;
}
