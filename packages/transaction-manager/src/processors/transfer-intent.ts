import {
  getNativeTransferIntentInstructionDataDecoder,
  getTokenTransferIntentInstructionDataDecoder,
  MultiWalletInstruction,
  type TransactionAuthDetails,
} from "@revibase/core";
import type { Instruction } from "gill";
import type {
  Secp256r1VerifyData,
  TransactionManagerConfig,
  WellKnownClientEntry,
} from "../types";
import {
  getSecp256r1Signers,
  verifyAndParseSigners,
} from "../utils/transaction-parsing";

/**
 * Processes a standard transfer intent instruction (native or token).
 */
export async function processTransferIntent(
  instructionType: MultiWalletInstruction,
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
  authResponses: TransactionAuthDetails[] | undefined,
  transactionManagerConfig: TransactionManagerConfig,
  getClientDetails?: (clientOrigin: string) => Promise<WellKnownClientEntry>,
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

  const decodedInstructionData = instructionDataDecoder.decode(
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

  const numFixedAccounts =
    instructionType === MultiWalletInstruction.NativeTransferIntent ? 6 : 18;
  const addressSigners = decodedInstructionData.signers
    .filter((x) => x.__kind === "Ed25519")
    .map((x) => ({
      signer: instruction.accounts![numFixedAccounts + x.fields[0]].address,
    }));

  return verifyAndParseSigners(
    [instruction],
    settingsAddress,
    sepcp256r1Signers.concat(addressSigners),
    transactionManagerConfig,
    authResponses,
    getClientDetails,
  );
}
