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

export async function processTransactionBufferAndExecute(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  instructionKind: MultiWalletInstruction,
  transactionManager: TransactionManagerConfig,
  instructionIndex: number,
  authResponses?: TransactionAuthDetails[],
  secp256r1VerifyDataList?: Secp256r1VerifyData[],
  transactionMessageBytes?: string,
) {
  if (!instruction.accounts) {
    throw new Error("Invalid instruction accounts");
  }
  if (!instruction.data) {
    throw new Error("Invalid instruction data");
  }

  validateTransactionManagerRole(instruction, transactionManager);

  const isBufferCreate =
    instructionKind === MultiWalletInstruction.TransactionBufferCreate ||
    instructionKind ===
      MultiWalletInstruction.TransactionBufferCreateCompressed;
  const isCompressed =
    instructionKind ===
      MultiWalletInstruction.TransactionBufferCreateCompressed ||
    instructionKind === MultiWalletInstruction.TransactionExecuteSyncCompressed;

  let result: ProcessingResult;

  if (isBufferCreate) {
    result = await processBufferCreate(
      rpc,
      instruction,
      isCompressed,
      transactionMessageBytes,
    );
  } else {
    result = await processExecuteSync(
      instruction,
      isCompressed,
      secp256r1VerifyDataList,
      instructionIndex,
    );
  }

  return verifyAndParseSigners(
    result.instructionsToVerify,
    result.settingsAddress,
    result.signers,
    authResponses,
  );
}

function validateTransactionManagerRole(
  instruction: Instruction,
  transactionManager: TransactionManagerConfig,
): void {
  const transactionManagerAccount = instruction.accounts?.find(
    (account) => account.address.toString() === transactionManager.publicKey,
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
  isCompressed: boolean,
  transactionMessageBytes?: string,
): Promise<ProcessingResult> {
  if (!transactionMessageBytes) {
    throw new Error("Missing transaction message bytes");
  }
  if (!instruction.data || !instruction.accounts) {
    throw new Error("Invalid instruction");
  }

  const txBytes = new Uint8Array(
    getBase64Encoder().encode(transactionMessageBytes),
  );

  if (isCompressed) {
    return processCompressedBufferCreate(rpc, instruction, txBytes);
  }

  return processStandardBufferCreate(rpc, instruction, txBytes);
}

async function processCompressedBufferCreate(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  txBytes: Uint8Array,
): Promise<ProcessingResult> {
  const decodedData =
    getTransactionBufferCreateCompressedInstructionDataDecoder().decode(
      instruction.data!,
    );

  const settingsAddress = await extractSettingsFromCompressed(
    decodedData.settingsReadonlyArgs,
    "Settings account is required for compressed transaction buffer create",
  );

  const signers = mapExpectedSigners(decodedData.args.expectedSecp256r1Signers);

  const isHashValid = await verifyTransactionBufferHash(
    decodedData.args,
    txBytes,
  );
  if (!isHashValid) {
    throw new Error("Hash mismatch.");
  }

  const instructionsToVerify = await parseTransactionMessageBytes(rpc, txBytes);

  return { settingsAddress, signers, instructionsToVerify };
}

async function processStandardBufferCreate(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  txBytes: Uint8Array,
): Promise<ProcessingResult> {
  const decodedData = getTransactionBufferCreateInstructionDataDecoder().decode(
    instruction.data!,
  );

  const settingsAddress = instruction.accounts![0].address.toString();
  const signers = mapExpectedSigners(decodedData.args.expectedSecp256r1Signers);

  const isHashValid = await verifyTransactionBufferHash(
    decodedData.args,
    txBytes,
  );
  if (!isHashValid) {
    throw new Error("Hash mismatch.");
  }

  const instructionsToVerify = await parseTransactionMessageBytes(rpc, txBytes);

  return { settingsAddress, signers, instructionsToVerify };
}

async function processExecuteSync(
  instruction: Instruction,
  isCompressed: boolean,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
): Promise<ProcessingResult> {
  if (!instruction.data || !instruction.accounts) {
    throw new Error("Invalid instruction");
  }

  if (isCompressed) {
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
  const decodedData =
    getTransactionExecuteSyncCompressedInstructionDataDecoder().decode(
      instruction.data!,
    );

  const settingsAddress = await extractSettingsFromCompressed(
    decodedData.settingsMutArgs,
    "Settings account is required for compressed transaction execute",
  );

  const signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedData.secp256r1VerifyArgs,
  );

  const instructionsToVerify = parseInnerTransaction(
    instruction.accounts,
    decodedData.transactionMessage,
  );

  return { settingsAddress, signers, instructionsToVerify };
}

async function processStandardExecuteSync(
  instruction: Instruction,
  secp256r1VerifyDataList: Secp256r1VerifyData[] | undefined,
  instructionIndex: number,
): Promise<ProcessingResult> {
  const decodedData = getTransactionExecuteSyncInstructionDataDecoder().decode(
    instruction.data!,
  );

  const settingsAddress = instruction.accounts![0].address.toString();

  const signers = await getSecp256r1Signers(
    secp256r1VerifyDataList,
    instructionIndex,
    decodedData.secp256r1VerifyArgs,
  );

  const instructionsToVerify = parseInnerTransaction(
    instruction.accounts,
    decodedData.transactionMessage,
  );

  return { settingsAddress, signers, instructionsToVerify };
}
