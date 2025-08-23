import {
  Instruction,
  none,
  OptionOrNullable,
  some,
  TransactionSigner,
} from "@solana/kit";
import {
  getCompressedSettingsAddressFromIndex,
  getUserAddress,
} from "../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewAddressesParams,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import {
  getCreateMultiWalletCompressedInstruction,
  getCreateMultiWalletInstruction,
  getUserDecoder,
  User,
  UserMutArgsArgs,
} from "../generated";
import { Permission, Permissions, Secp256r1Key } from "../types";
import {
  getGlobalCounterAddress,
  getLightProtocolRpc,
  getSettingsFromIndex,
} from "../utils";
import { extractSecp256r1VerificationArgs } from "../utils/internal";
import { Secp256r1VerifyInput } from "./secp256r1Verify";

export async function createWallet({
  index,
  payer,
  initialMember,
  permissions,
  compressed = false,
}: {
  index: bigint | number;
  payer: TransactionSigner;
  initialMember: TransactionSigner | Secp256r1Key;
  permissions: Permissions;
  compressed?: boolean;
}) {
  const globalCounter = await getGlobalCounterAddress();
  const {
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    slotHashSysvar,
    message,
    signature,
    publicKey,
  } = extractSecp256r1VerificationArgs(initialMember);

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  if (message && signature && publicKey) {
    secp256r1VerifyInput.push({
      message,
      signature,
      publicKey,
    });
  }

  const packedAccounts = new PackedAccounts();
  if (Permissions.has(permissions, Permission.IsDelegate) || compressed) {
    await packedAccounts.addSystemAccounts();
  }
  const newAddressParams = [];
  const hashesWithTree = [];

  if (Permissions.has(permissions, Permission.IsDelegate)) {
    const member =
      "address" in initialMember ? initialMember.address : initialMember;
    const userAddress = await getUserAddress(member);
    hashesWithTree.push(
      ...(await getCompressedAccountHashes([
        {
          pubkey: userAddress,
          type: "User" as const,
        },
      ]))
    );
  }

  if (compressed) {
    const settingsAddress = await getCompressedSettingsAddressFromIndex(index);
    newAddressParams.push(
      ...getNewAddressesParams([
        {
          pubkey: settingsAddress,
          type: "Settings" as const,
        },
      ])
    );
  }
  const hashesWithTreeEndIndex = hashesWithTree.length;

  const proof = await getLightProtocolRpc().getValidityProofV0(
    hashesWithTree,
    newAddressParams
  );

  let userMutArgs: OptionOrNullable<UserMutArgsArgs> = none();
  if (hashesWithTreeEndIndex > 0) {
    const mutArgs = getCompressedAccountMutArgs<User>(
      packedAccounts,
      proof.treeInfos.slice(0, hashesWithTreeEndIndex),
      proof.leafIndices.slice(0, hashesWithTreeEndIndex),
      proof.rootIndices.slice(0, hashesWithTreeEndIndex),
      proof.proveByIndices.slice(0, hashesWithTreeEndIndex),
      hashesWithTree.filter((x) => x.type === "User"),
      getUserDecoder()
    )[0];
    userMutArgs = some(mutArgs);
  }

  const initArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos.slice(hashesWithTreeEndIndex),
    proof.roots.slice(hashesWithTreeEndIndex),
    proof.rootIndices.slice(hashesWithTreeEndIndex),
    newAddressParams,
    hashesWithTreeEndIndex > 0
      ? proof.treeInfos.slice(0, hashesWithTreeEndIndex)
      : undefined
  );

  const settingsCreationArgs =
    initArgs.find((x) => x.type === "Settings") ?? null;

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];

  if (compressed) {
    if (!settingsCreationArgs) {
      throw new Error("Settings creation args is missing.");
    }

    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset
    );
    instructions.push(
      getCreateMultiWalletCompressedInstruction({
        settingsIndex: index,
        instructionsSysvar,
        slotHashSysvar,
        payer: payer,
        initialMember:
          initialMember instanceof Secp256r1Key ? undefined : initialMember,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        permissions,
        userMutArgs,
        globalCounter,
        compressedProofArgs,
        settingsCreation: settingsCreationArgs,
        remainingAccounts,
      })
    );
  } else {
    const settings = await getSettingsFromIndex(index);
    instructions.push(
      getCreateMultiWalletInstruction({
        settings,
        instructionsSysvar,
        slotHashSysvar,
        payer,
        initialMember:
          initialMember instanceof Secp256r1Key ? undefined : initialMember,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        permissions,
        userMutArgs,
        globalCounter,
        compressedProofArgs: convertToCompressedProofArgs(proof, systemOffset),
        remainingAccounts,
      })
    );
  }

  return { instructions, secp256r1VerifyInput };
}
