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

/**
 * Processes a ChangeConfigCompressed instruction.
 */
export async function processChangeConfigCompressed(
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
    throw new Error("Invalid instruction accounts");
  }

  const decodedInstructionData =
    getChangeConfigCompressedInstructionDataDecoder().decode(instruction.data);

  const settingsAddress = await extractSettingsFromCompressed(
    decodedInstructionData.settingsMutArgs,
    "Invalid instruction data. Settings not found.",
  );

  const sepcp256r1Signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedInstructionData.signers
      .filter((x) => x.__kind === "Secp256r1")
      .map((x) => x.fields[0]),
  );

  const numFixedAccounts = 3;
  const addressSigners = decodedInstructionData.signers
    .filter((x) => x.__kind === "Ed25519")
    .map((x) => ({
      signer: instruction.accounts![numFixedAccounts + x.fields[0]].address,
    }));

  return verifyAndParseSigners(
    [instruction],
    settingsAddress,
    sepcp256r1Signers.concat(addressSigners),
    authResponses,
    wellKnownProxyUrl,
  );
}

/**
 * Processes a ChangeConfig instruction.
 */
export async function processChangeConfig(
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

  const decodedInstructionData = getChangeConfigInstructionDataDecoder().decode(
    instruction.data,
  );

  const settingsAddress = instruction.accounts[0].address.toString();

  const sepcp256r1Signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedInstructionData.signers
      .filter((x) => x.__kind === "Secp256r1")
      .map((x) => x.fields[0]),
  );

  const numFixedAccounts = 5;
  const addressSigners = decodedInstructionData.signers
    .filter((x) => x.__kind === "Ed25519")
    .map((x) => ({
      signer: instruction.accounts![numFixedAccounts + x.fields[0]].address,
    }));

  return verifyAndParseSigners(
    [instruction],
    settingsAddress,
    sepcp256r1Signers.concat(addressSigners),
    authResponses,
    wellKnownProxyUrl,
  );
}
