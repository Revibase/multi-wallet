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
import type {
  Secp256r1VerifyData,
  TransactionManagerConfig,
  VerificationResults,
} from "./types";
import { SECP256R1_VERIFY_PROGRAM, WHITELISTED_PROGRAMS } from "./utils/consts";
import { decompileTransactionMessageFetchingLookupTablesWithCache } from "./utils/transaction-parsing";

/**
 * Decode and verify a serialized Solana transaction.
 *
 * @param rpc - Solana RPC client used to fetch lookup tables.
 * @param transactionManagerConfig - Public key and URL of the transaction manager.
 * @param payload - Verification input.
 * @param wellKnownProxyUrl - Optional proxy URL for fetching well-known client config.
 * @returns The transaction message bytes and, per multi-wallet instruction batch,
 *   the extracted instructions and the signers that passed verification.
 */
export async function verifyTransaction(
  rpc: Rpc<SolanaRpcApi>,
  transactionManagerConfig: TransactionManagerConfig,
  payload: {
    transaction: string;
    transactionMessageBytes?: string;
    authResponses?: TransactionAuthDetails[];
  },
  wellKnownProxyUrl?: URL,
): Promise<VerificationResults> {
  const { transaction, transactionMessageBytes, authResponses } = payload;
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

  const verificationResults = (
    await Promise.all(
      instructions.map((instruction, instructionIndex) =>
        processInstruction(
          rpc,
          instruction,
          transactionManagerConfig,
          instructionIndex,
          authResponses,
          secp256r1VerifyDataList,
          transactionMessageBytes,
          wellKnownProxyUrl,
        ),
      ),
    )
  ).filter((result) => result !== null);

  return { transactionMessage: messageBytes, verificationResults };
}

function extractSecp256r1VerifyData(
  instructions: readonly Instruction[],
): Secp256r1VerifyData[] {
  return instructions
    .map((instruction, instructionIndex) => ({ instruction, instructionIndex }))
    .filter(
      ({ instruction }) =>
        instruction.programAddress.toString() === SECP256R1_VERIFY_PROGRAM,
    )
    .map(({ instructionIndex, instruction }) => ({
      instructionIndex,
      data: instruction.data,
    }));
}

async function processInstruction(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  transactionManagerConfig: TransactionManagerConfig,
  instructionIndex: number,
  authResponses?: TransactionAuthDetails[],
  secp256r1VerifyDataList?: Secp256r1VerifyData[],
  transactionMessageBytes?: string,
  wellKnownProxyUrl?: URL,
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

  const instructionType = identifyMultiWalletInstruction({
    data: instruction.data,
  });

  return routeInstruction(
    rpc,
    instruction,
    instructionType,
    transactionManagerConfig,
    instructionIndex,
    authResponses,
    secp256r1VerifyDataList,
    transactionMessageBytes,
    wellKnownProxyUrl,
  );
}

async function routeInstruction(
  rpc: Rpc<SolanaRpcApi>,
  instruction: Instruction,
  instructionType: MultiWalletInstruction,
  transactionManagerConfig: TransactionManagerConfig,
  instructionIndex: number,
  authResponses?: TransactionAuthDetails[],
  secp256r1VerifyDataList?: Secp256r1VerifyData[],
  transactionMessageBytes?: string,
  wellKnownProxyUrl?: URL,
) {
  switch (instructionType) {
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
        wellKnownProxyUrl,
      );

    case MultiWalletInstruction.ChangeConfigCompressed:
      return processChangeConfigCompressed(
        instruction,
        secp256r1VerifyDataList,
        instructionIndex,
        authResponses,
        wellKnownProxyUrl,
      );

    case MultiWalletInstruction.CreateUserAccounts:
      return processCreateUserAccounts(instruction, transactionManagerConfig);

    case MultiWalletInstruction.EditTransactionManagerUrl:
      return processEditTransactionManagerUrl(
        instruction,
        transactionManagerConfig,
      );

    case MultiWalletInstruction.NativeTransferIntent:
    case MultiWalletInstruction.TokenTransferIntent:
      return processTransferIntent(
        instructionType,
        instruction,
        secp256r1VerifyDataList,
        instructionIndex,
        authResponses,
        wellKnownProxyUrl,
      );

    case MultiWalletInstruction.NativeTransferIntentCompressed:
    case MultiWalletInstruction.TokenTransferIntentCompressed:
      return processCompressedTransferIntent(
        instructionType,
        instruction,
        secp256r1VerifyDataList,
        instructionIndex,
        authResponses,
        wellKnownProxyUrl,
      );

    case MultiWalletInstruction.TransactionBufferCreate:
    case MultiWalletInstruction.TransactionBufferCreateCompressed:
    case MultiWalletInstruction.TransactionExecuteSync:
    case MultiWalletInstruction.TransactionExecuteSyncCompressed:
      return processTransactionBufferAndExecute(
        rpc,
        instruction,
        instructionType,
        transactionManagerConfig,
        instructionIndex,
        authResponses,
        secp256r1VerifyDataList,
        transactionMessageBytes,
        wellKnownProxyUrl,
      );

    default:
      throw new Error("Instruction rejected by transaction manager.");
  }
}
