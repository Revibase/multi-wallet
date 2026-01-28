import {
  getChangeConfigCompressedInstructionDataDecoder,
  getChangeConfigInstructionDataDecoder,
  type TransactionAuthDetails,
} from "@revibase/core";
import type { Instruction } from "gill";
import type { Secp256r1VerifyData } from "../types";
import {
  extractSettingsFromCompressed,
  getSecp256r1Signers,
  verifyAndParseSigners,
} from "../utils/transaction-parsing";

export async function processChangeConfigCompressed(
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
  authResponses: TransactionAuthDetails[] | undefined,
) {
  if (!instruction.data) {
    throw new Error("Invalid instruction data.");
  }

  const decodedData = getChangeConfigCompressedInstructionDataDecoder().decode(
    instruction.data,
  );

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

export async function processChangeConfig(
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

  const decodedData = getChangeConfigInstructionDataDecoder().decode(
    instruction.data,
  );

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
