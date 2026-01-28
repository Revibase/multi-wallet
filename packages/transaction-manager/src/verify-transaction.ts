import {
  identifyMultiWalletInstruction,
  MULTI_WALLET_PROGRAM_ADDRESS,
  MultiWalletInstruction,
  type TransactionAuthDetails,
} from "@revibase/core";
import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
} from "gill";
import {
  processChangeConfig,
  processChangeConfigCompressed,
  processCompressedTransferIntent,
  processCreateUserAccounts,
  processEditTransactionManagerUrl,
  processTransactionBufferAndExecute,
  processTransferIntent,
} from "./processors";
import type { Secp256r1VerifyData, TransactionManagerConfig } from "./types";
import { SECP256R1_VERIFY_PROGRAM, WHITELISTED_PROGRAMS } from "./utils/consts";
import { decompileTransactionMessageFetchingLookupTablesWithCache } from "./utils/transaction-parsing";

export async function verifyTransaction(
  rpc: Rpc<SolanaRpcApi>,
  transactionManager: TransactionManagerConfig,
  transaction: string,
  authResponses?: TransactionAuthDetails[],
  transactionMessageBytes?: string,
) {
  const { messageBytes } = getTransactionDecoder().decode(
    getBase64Encoder().encode(transaction),
  );

  const compiledMessage =
    getCompiledTransactionMessageDecoder().decode(messageBytes);

  const { instructions } =
    await decompileTransactionMessageFetchingLookupTablesWithCache(
      compiledMessage,
      rpc,
    );

  const secp256r1VerifyDataList = extractSecp256r1VerifyData(instructions);

  const verifiedResult = (
    await Promise.all(
      instructions.map((instruction, idx) =>
        processInstruction(
          rpc,
          instruction,
          transactionManager,
          idx,
          authResponses,
          secp256r1VerifyDataList,
          transactionMessageBytes,
        ),
      ),
    )
  ).filter((x) => x !== null);

  return verifiedResult;
}

function extractSecp256r1VerifyData(
  instructions: readonly Instruction[],
): Secp256r1VerifyData[] {
  return instructions
    .map((instruction, idx) => ({ instruction, idx }))
    .filter(
      ({ instruction }) =>
        instruction.programAddress.toString() === SECP256R1_VERIFY_PROGRAM,
    )
    .map(({ idx, instruction }) => ({
      instructionIndex: idx,
      data: instruction.data,
    }));
}

async function processInstruction(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  transactionManager: TransactionManagerConfig,
  instructionIndex: number,
  authResponses?: TransactionAuthDetails[],
  secp256r1VerifyDataList?: Secp256r1VerifyData[],
  transactionMessageBytes?: string,
) {
  const programAddress = instruction.programAddress.toString();

  if (!WHITELISTED_PROGRAMS.has(programAddress)) {
    throw new Error("Instruction rejected by Transaction Manager.");
  }

  if (programAddress !== MULTI_WALLET_PROGRAM_ADDRESS.toString()) {
    return null;
  }

  if (!instruction.data) {
    throw new Error("Invalid instruction data.");
  }

  const instructionKind = identifyMultiWalletInstruction({
    data: instruction.data,
  });

  return routeInstruction(
    rpc,
    instruction,
    instructionKind,
    transactionManager,
    instructionIndex,
    authResponses,
    secp256r1VerifyDataList,
    transactionMessageBytes,
  );
}

async function routeInstruction(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  instructionKind: MultiWalletInstruction,
  transactionManager: TransactionManagerConfig,
  instructionIndex: number,
  authResponses?: TransactionAuthDetails[],
  secp256r1VerifyDataList?: Secp256r1VerifyData[],
  transactionMessageBytes?: string,
) {
  switch (instructionKind) {
    case MultiWalletInstruction.DecompressSettingsAccount:
    case MultiWalletInstruction.TransactionBufferClose:
    case MultiWalletInstruction.TransactionBufferCloseCompressed:
      return null;

    case MultiWalletInstruction.ChangeConfig:
      return processChangeConfig(
        instruction,
        secp256r1VerifyDataList,
        instructionIndex,
        authResponses,
      );

    case MultiWalletInstruction.ChangeConfigCompressed:
      return processChangeConfigCompressed(
        instruction,
        secp256r1VerifyDataList,
        instructionIndex,
        authResponses,
      );

    case MultiWalletInstruction.CreateUserAccounts:
      return processCreateUserAccounts(instruction, transactionManager);

    case MultiWalletInstruction.EditTransactionManagerUrl:
      return processEditTransactionManagerUrl(instruction, transactionManager);

    case MultiWalletInstruction.NativeTransferIntent:
    case MultiWalletInstruction.TokenTransferIntent:
      return processTransferIntent(
        instructionKind,
        instruction,
        secp256r1VerifyDataList,
        instructionIndex,
        authResponses,
      );

    case MultiWalletInstruction.NativeTransferIntentCompressed:
    case MultiWalletInstruction.TokenTransferIntentCompressed:
      return processCompressedTransferIntent(
        instructionKind,
        instruction,
        secp256r1VerifyDataList,
        instructionIndex,
        authResponses,
      );

    case MultiWalletInstruction.TransactionBufferCreate:
    case MultiWalletInstruction.TransactionBufferCreateCompressed:
    case MultiWalletInstruction.TransactionExecuteSync:
    case MultiWalletInstruction.TransactionExecuteSyncCompressed:
      return processTransactionBufferAndExecute(
        rpc,
        instruction,
        instructionKind,
        transactionManager,
        instructionIndex,
        authResponses,
        secp256r1VerifyDataList,
        transactionMessageBytes,
      );

    default:
      throw new Error("Instruction rejected by transaction manager.");
  }
}
