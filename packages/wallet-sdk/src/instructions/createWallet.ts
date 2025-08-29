import { Instruction, TransactionSigner } from "@solana/kit";
import {
  getCreateMultiWalletCompressedInstruction,
  getCreateMultiWalletInstruction,
  getUserDecoder,
  User,
} from "../generated";
import { Permissions, Secp256r1Key } from "../types";
import {
  getCompressedSettingsAddressFromIndex,
  getGlobalCounterAddress,
  getLightProtocolRpc,
  getSettingsFromIndex,
  getUserAddress,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewAddressesParams,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import { extractSecp256r1VerificationArgs } from "../utils/transactionMessage/internal";
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
  await packedAccounts.addSystemAccounts();

  const newAddressParams = [];
  const hashesWithTree = [];

  const member =
    "address" in initialMember ? initialMember.address : initialMember;
  const userAddress = await getUserAddress(member);
  hashesWithTree.push(
    ...(await getCompressedAccountHashes([
      {
        address: userAddress,
        type: "User" as const,
      },
    ]))
  );

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
    newAddressParams,
    hashesWithTreeEndIndex > 0
      ? proof.treeInfos.slice(0, hashesWithTreeEndIndex)
      : undefined
  );

  const settingsCreationArgs =
    initArgs.find((x) => x.type === "Settings") ?? null;

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  const instructions: Instruction[] = [];
  if (compressed) {
    if (!settingsCreationArgs) {
      throw new Error("Settings creation args is missing.");
    }

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
        compressedProofArgs,
        remainingAccounts,
      })
    );
  }

  return { instructions, secp256r1VerifyInput };
}
