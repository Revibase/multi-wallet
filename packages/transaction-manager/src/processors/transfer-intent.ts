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

/**
 * Processes a compressed transfer intent instruction (native or token).
 */
export async function processCompressedTransferIntent(
  instructionType: MultiWalletInstruction,
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
  authResponses: TransactionAuthDetails[] | undefined,
  wellKnownProxyUrl?: URL,
) {
  if (!instruction.data) {
    throw new Error("Invalid instruction data.");
  }

  const instructionDataDecoder =
    instructionType === MultiWalletInstruction.NativeTransferIntentCompressed
      ? getNativeTransferIntentCompressedInstructionDataDecoder()
      : getTokenTransferIntentCompressedInstructionDataDecoder();

  const decodedInstructionData = instructionDataDecoder.decode(instruction.data);

  const settingsAddress = await extractSettingsFromCompressed(
    decodedInstructionData.settingsMutArgs,
    "Invalid instruction data. Settings not found.",
  );

  const signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedInstructionData.secp256r1VerifyArgs,
  );

  return verifyAndParseSigners(
    [instruction],
    settingsAddress,
    signers,
    authResponses,
    wellKnownProxyUrl,
  );
}

/**
 * Processes a standard transfer intent instruction (native or token).
 */
export async function processTransferIntent(
  instructionType: MultiWalletInstruction,
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
  authResponses: TransactionAuthDetails[] | undefined,
  wellKnownProxyUrl?: URL,
) {
  if (!instruction.data) {
    throw new Error("Invalid instruction data.");
  }
  if (!instruction.accounts) {
    throw new Error("Invalid instruction accounts.");
  }

  const instructionDataDecoder =
    instructionType === MultiWalletInstruction.NativeTransferIntent
      ? getNativeTransferIntentInstructionDataDecoder()
      : getTokenTransferIntentInstructionDataDecoder();

  const decodedInstructionData = instructionDataDecoder.decode(instruction.data);

  const settingsAddress = instruction.accounts[0].address.toString();

  const signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedInstructionData.secp256r1VerifyArgs,
  );

  return verifyAndParseSigners(
    [instruction],
    settingsAddress,
    signers,
    authResponses,
    wellKnownProxyUrl,
  );
}
