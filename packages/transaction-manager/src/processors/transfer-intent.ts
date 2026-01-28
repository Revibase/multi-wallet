import {
  getNativeTransferIntentCompressedInstructionDataDecoder,
  getNativeTransferIntentInstructionDataDecoder,
  getTokenTransferIntentCompressedInstructionDataDecoder,
  getTokenTransferIntentInstructionDataDecoder,
  MultiWalletInstruction,
  type TransactionAuthDetails,
} from "@revibase/core";
import type { Instruction } from "gill";
import type { Secp256r1VerifyData } from "../types";
import {
  extractSettingsFromCompressed,
  getSecp256r1Signers,
  verifyAndParseSigners,
} from "../utils/transaction-parsing";

export async function processCompressedTransferIntent(
  instructionKind: MultiWalletInstruction,
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
  authResponses: TransactionAuthDetails[] | undefined,
) {
  if (!instruction.data) {
    throw new Error("Invalid instruction data.");
  }

  const decoder =
    instructionKind === MultiWalletInstruction.NativeTransferIntentCompressed
      ? getNativeTransferIntentCompressedInstructionDataDecoder()
      : getTokenTransferIntentCompressedInstructionDataDecoder();

  const decodedData = decoder.decode(instruction.data);

  const settingsAddress = await extractSettingsFromCompressed(
    decodedData.settingsMutArgs,
    "Invalid instruction data. Settings not found.",
  );

  const signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedData.secp256r1VerifyArgs,
  );

  return verifyAndParseSigners(
    [instruction],
    settingsAddress,
    signers,
    authResponses,
  );
}

export async function processTransferIntent(
  instructionKind: MultiWalletInstruction,
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
  authResponses: TransactionAuthDetails[] | undefined,
) {
  if (!instruction.data) {
    throw new Error("Invalid instruction data.");
  }
  if (!instruction.accounts) {
    throw new Error("Invalid instruction accounts.");
  }

  const decoder =
    instructionKind === MultiWalletInstruction.NativeTransferIntent
      ? getNativeTransferIntentInstructionDataDecoder()
      : getTokenTransferIntentInstructionDataDecoder();

  const decodedData = decoder.decode(instruction.data);

  const signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedData.secp256r1VerifyArgs,
  );

  return verifyAndParseSigners(
    [instruction],
    instruction.accounts[0].address.toString(),
    signers,
    authResponses,
  );
}
