import {
  getTransactionBufferCreateCompressedInstructionDataDecoder,
  getTransactionBufferCreateInstructionDataDecoder,
  getTransactionExecuteSyncCompressedInstructionDataDecoder,
  getTransactionExecuteSyncInstructionDataDecoder,
  MultiWalletInstruction,
  type TransactionAuthDetails,
} from "@revibase/core";
import {
  AccountRole,
  getBase64Encoder,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
} from "gill";
import type {
  ProcessingResult,
  Secp256r1VerifyData,
  TransactionManagerConfig,
} from "../types";
import {
  extractSettingsFromCompressed,
  getSecp256r1Signers,
  mapExpectedSigners,
  parseInnerTransaction,
  parseTransactionMessageBytes,
  verifyAndParseSigners,
  verifyTransactionBufferHash,
} from "../utils/transaction-parsing";

/**
 * Processes transaction buffer creation and synchronous execution instructions.
 */
export async function processTransactionBufferAndExecute(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  instructionType: MultiWalletInstruction,
  transactionManagerConfig: TransactionManagerConfig,
  instructionIndex: number,
  authResponses?: TransactionAuthDetails[],
  secp256r1VerifyDataList?: Secp256r1VerifyData[],
  base64TransactionMessageBytes?: string,
  wellKnownProxyUrl?: URL,
) {
  if (!instruction.accounts) {
    throw new Error("Invalid instruction accounts");
  }
  if (!instruction.data) {
    throw new Error("Invalid instruction data");
  }

  validateTransactionManagerAccountRole(instruction, transactionManagerConfig);

  const isBufferCreateInstruction =
    instructionType === MultiWalletInstruction.TransactionBufferCreate ||
    instructionType ===
      MultiWalletInstruction.TransactionBufferCreateCompressed;

  const isCompressedInstruction =
    instructionType ===
      MultiWalletInstruction.TransactionBufferCreateCompressed ||
    instructionType === MultiWalletInstruction.TransactionExecuteSyncCompressed;

  let processingResult: ProcessingResult;

  if (isBufferCreateInstruction) {
    processingResult = await processBufferCreate(
      rpc,
      instruction,
      isCompressedInstruction,
      base64TransactionMessageBytes,
    );
  } else {
    processingResult = await processExecuteSync(
      instruction,
      isCompressedInstruction,
      secp256r1VerifyDataList,
      instructionIndex,
    );
  }

  return verifyAndParseSigners(
    processingResult.instructionsToVerify,
    processingResult.settingsAddress,
    processingResult.signers,
    authResponses,
    wellKnownProxyUrl,
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
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  isCompressedInstruction: boolean,
  base64TransactionMessageBytes?: string,
): Promise<ProcessingResult> {
  if (!base64TransactionMessageBytes) {
    throw new Error("Missing transaction message bytes");
  }
  if (!instruction.data || !instruction.accounts) {
    throw new Error("Invalid instruction");
  }

  const transactionMessageBytes = new Uint8Array(
    getBase64Encoder().encode(base64TransactionMessageBytes),
  );

  if (isCompressedInstruction) {
    return processCompressedBufferCreate(
      rpc,
      instruction,
      transactionMessageBytes,
    );
  }

  return processStandardBufferCreate(rpc, instruction, transactionMessageBytes);
}

async function processCompressedBufferCreate(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  transactionMessageBytes: Uint8Array<ArrayBuffer>,
): Promise<ProcessingResult> {
  const decodedInstructionData =
    getTransactionBufferCreateCompressedInstructionDataDecoder().decode(
      instruction.data!,
    );

  const settingsAddress = await extractSettingsFromCompressed(
    decodedInstructionData.settingsReadonlyArgs,
    "Settings account is required for compressed transaction buffer create",
  );

  const expectedSigners = mapExpectedSigners(
    decodedInstructionData.args.expectedSecp256r1Signers,
  );

  const isHashValid = await verifyTransactionBufferHash(
    decodedInstructionData.args,
    transactionMessageBytes,
  );
  if (!isHashValid) {
    throw new Error("Hash mismatch.");
  }

  const innerInstructions = await parseTransactionMessageBytes(
    rpc,
    transactionMessageBytes,
  );

  return {
    settingsAddress,
    signers: expectedSigners,
    instructionsToVerify: innerInstructions,
  };
}

async function processStandardBufferCreate(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  transactionMessageBytes: Uint8Array<ArrayBuffer>,
): Promise<ProcessingResult> {
  const decodedInstructionData =
    getTransactionBufferCreateInstructionDataDecoder().decode(
      instruction.data!,
    );

  const settingsAddress = instruction.accounts![0].address.toString();
  const expectedSigners = mapExpectedSigners(
    decodedInstructionData.args.expectedSecp256r1Signers,
  );

  const isHashValid = await verifyTransactionBufferHash(
    decodedInstructionData.args,
    transactionMessageBytes,
  );
  if (!isHashValid) {
    throw new Error("Hash mismatch.");
  }

  const innerInstructions = await parseTransactionMessageBytes(
    rpc,
    transactionMessageBytes,
  );

  return {
    settingsAddress,
    signers: expectedSigners,
    instructionsToVerify: innerInstructions,
  };
}

async function processExecuteSync(
  instruction: Instruction,
  isCompressedInstruction: boolean,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
): Promise<ProcessingResult> {
  if (!instruction.data || !instruction.accounts) {
    throw new Error("Invalid instruction");
  }

  if (isCompressedInstruction) {
    return processCompressedExecuteSync(
      instruction,
      secp256r1VerifyDataList,
      instructionIndex,
    );
  }

  return processStandardExecuteSync(
    instruction,
    secp256r1VerifyDataList,
    instructionIndex,
  );
}

async function processCompressedExecuteSync(
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
): Promise<ProcessingResult> {
  const decodedInstructionData =
    getTransactionExecuteSyncCompressedInstructionDataDecoder().decode(
      instruction.data!,
    );

  const settingsAddress = await extractSettingsFromCompressed(
    decodedInstructionData.settingsMutArgs,
    "Settings account is required for compressed transaction execute",
  );

  const signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedInstructionData.secp256r1VerifyArgs,
  );

  const innerInstructions = parseInnerTransaction(
    instruction.accounts,
    decodedInstructionData.transactionMessage,
  );

  return {
    settingsAddress,
    signers,
    instructionsToVerify: innerInstructions,
  };
}

async function processStandardExecuteSync(
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
): Promise<ProcessingResult> {
  const decodedInstructionData =
    getTransactionExecuteSyncInstructionDataDecoder().decode(instruction.data!);

  const settingsAddress = instruction.accounts![0].address.toString();

  const signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedInstructionData.secp256r1VerifyArgs,
  );

  const innerInstructions = parseInnerTransaction(
    instruction.accounts,
    decodedInstructionData.transactionMessage,
  );

  return {
    settingsAddress,
    signers,
    instructionsToVerify: innerInstructions,
  };
}
