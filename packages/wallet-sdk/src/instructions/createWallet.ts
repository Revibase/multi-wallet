import { IInstruction, TransactionSigner } from "@solana/kit";
import {
  getCompressedSettingsAddressFromIndex,
  getDelegateAddress,
} from "../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import {
  getCreateMultiWalletCompressedInstruction,
  getCreateMultiWalletInstructionAsync,
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
  const settings = await getSettingsFromIndex(index);
  const globalCounter = await getGlobalCounterAddress();
  const {
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    slotHashSysvar,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(initialMember);

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
  if (compressed) {
    const settingsAddress = await getCompressedSettingsAddressFromIndex(index);
    newAddressParams.push({
      pubkey: settingsAddress,
      type: "Settings" as const,
    });
  }
  if (Permissions.has(permissions, Permission.IsDelegate)) {
    const delegateAddress = await getDelegateAddress(
      "address" in initialMember ? initialMember.address : initialMember
    );
    newAddressParams.push({
      pubkey: delegateAddress,
      type: "Delegate" as const,
    });
  }
  const newAddressesParams = getNewAddressesParams(newAddressParams);
  const proof = await getLightProtocolRpc().getValidityProofV0(
    [],
    newAddressesParams
  );
  const initArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos,
    proof.roots,
    proof.rootIndices,
    newAddressesParams
  );
  const delegateCreationArgs =
    initArgs.find((x) => x.type === "Delegate") ?? null;
  const settingsCreationArgs =
    initArgs.find((x) => x.type === "Settings") ?? null;

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions: IInstruction[] = [];

  if (compressed) {
    if (!settingsCreationArgs) {
      throw new Error("Proof args is missing.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset
    );
    instructions.push(
      getCreateMultiWalletCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        payer: payer,
        initialMember:
          initialMember instanceof Secp256r1Key ? undefined : initialMember,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        permissions,
        delegateCreationArgs,
        globalCounter,
        compressedProofArgs,
        settingsCreationArgs: settingsCreationArgs,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      await getCreateMultiWalletInstructionAsync({
        settings,
        instructionsSysvar,
        slotHashSysvar,
        payer,
        initialMember:
          initialMember instanceof Secp256r1Key ? undefined : initialMember,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        permissions,
        delegateCreationArgs,
        globalCounter,
        compressedProofArgs: convertToCompressedProofArgs(proof, systemOffset),
        remainingAccounts,
      })
    );
  }

  return { instructions, secp256r1VerifyInput };
}
