import {
  getTransactionBufferCreateInstructionDataDecoder,
  getTransactionExecuteSyncInstructionDataDecoder,
  MultiWalletInstruction,
  type TransactionAuthDetails,
} from "@revibase/core";
import { AccountRole, getBase64Encoder, type Instruction } from "@solana/kit";
import type {
  ProcessingResult,
  Secp256r1VerifyData,
  TransactionManagerConfig,
  WellKnownClientEntry,
} from "../types";
import { verifyTransactionBufferHash } from "../utils/signature-verification";
import {
  getSecp256r1Signers,
  mapExpectedSigners,
  parseInnerTransaction,
  parseTransactionMessageBytes,
  verifyAndParseSigners,
} from "../utils/transaction-parsing";

/**
 * Processes transaction buffer creation and synchronous execution instructions.
 */
export async function processTransactionBufferAndExecute(
  instruction: Instruction,
  instructionType: MultiWalletInstruction,
  transactionManagerConfig: TransactionManagerConfig,
  instructionIndex: number,
  authResponses?: TransactionAuthDetails[],
  secp256r1VerifyDataList?: Secp256r1VerifyData[],
  transactionMessageBytes?: string,
  getClientDetails?: (clientOrigin: string) => Promise<WellKnownClientEntry>,
) {
  if (!instruction.accounts) {
    throw new Error("Invalid instruction accounts");
  }
  if (!instruction.data) {
    throw new Error("Invalid instruction data");
  }

  validateTransactionManagerAccountRole(instruction, transactionManagerConfig);

  const isBufferCreateInstruction =
    instructionType === MultiWalletInstruction.TransactionBufferCreate;

  let processingResult: ProcessingResult;

  if (isBufferCreateInstruction) {
    processingResult = await processBufferCreate(
      instruction,
      transactionMessageBytes,
    );
  } else {
    processingResult = await processExecuteSync(
      instruction,
      secp256r1VerifyDataList,
      instructionIndex,
    );
  }

  return verifyAndParseSigners(
    processingResult.instructionsToVerify,
    processingResult.settingsAddress,
    processingResult.signers,
    transactionManagerConfig,
    authResponses,
    getClientDetails,
  );
}

function validateTransactionManagerAccountRole(
  instruction: Instruction,
  transactionManagerConfig: TransactionManagerConfig,
): void {
  const transactionManagerAccount = instruction.accounts?.find(
    (account) =>
      account.address.toString() === transactionManagerConfig.publicKey,
  );

  if (
    transactionManagerAccount &&
    transactionManagerAccount.role !== AccountRole.READONLY_SIGNER
  ) {
    throw new Error("Transaction Manager should be readonly signer.");
  }
}

async function processBufferCreate(
  instruction: Instruction,
  transactionMessageBytes?: string,
): Promise<ProcessingResult> {
  if (!transactionMessageBytes) {
    throw new Error("Missing transaction message bytes");
  }
  if (!instruction.data || !instruction.accounts) {
    throw new Error("Invalid instruction");
  }

  const transactionMessage = getBase64Encoder().encode(
    transactionMessageBytes,
  ) as Uint8Array<ArrayBuffer>;

  return processStandardBufferCreate(instruction, transactionMessage);
}

async function processStandardBufferCreate(
  instruction: Instruction,
  transactionMessage: Uint8Array<ArrayBuffer>,
): Promise<ProcessingResult> {
  const decodedInstructionData =
    getTransactionBufferCreateInstructionDataDecoder().decode(
      instruction.data!,
    );

  const settingsAddress = instruction.accounts![0].address.toString();
  const expectedSigners = mapExpectedSigners(
    decodedInstructionData.expectedSigners,
  );

  const isHashValid = await verifyTransactionBufferHash(
    decodedInstructionData,
    transactionMessage,
  );
  if (!isHashValid) {
    throw new Error("Hash mismatch.");
  }

  const innerInstructions = parseTransactionMessageBytes(transactionMessage);

  return {
    settingsAddress,
    signers: expectedSigners,
    instructionsToVerify: innerInstructions,
  };
}

async function processExecuteSync(
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
): Promise<ProcessingResult> {
  if (!instruction.data || !instruction.accounts) {
    throw new Error("Invalid instruction");
  }

  return processStandardExecuteSync(
    instruction,
    secp256r1VerifyDataList,
    instructionIndex,
  );
}

async function processStandardExecuteSync(
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
): Promise<ProcessingResult> {
  if (!instruction.accounts) {
    throw new Error("Invalid instruction accounts.");
  }
  const decodedInstructionData =
    getTransactionExecuteSyncInstructionDataDecoder().decode(instruction.data!);

  const settingsAddress = instruction.accounts![0].address.toString();

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

  const innerInstructions = parseInnerTransaction(
    instruction.accounts,
    decodedInstructionData,
  );

  return {
    settingsAddress,
    signers: sepcp256r1Signers.concat(addressSigners),
    instructionsToVerify: innerInstructions,
  };
}
