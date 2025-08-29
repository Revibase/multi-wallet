import {
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "@solana/kit";
import {
  createTransactionBuffer,
  executeTransaction,
  executeTransactionBuffer,
  extendTransactionBuffer,
  Secp256r1VerifyInput,
  voteTransactionBuffer,
} from "../instructions";
import { Secp256r1Key } from "../types";
import { getSettingsFromIndex, getTransactionBufferAddress } from "../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../utils/compressed/internal";
import { getHash } from "../utils/transactionMessage/internal";

interface CreateTransactionBundleArgs {
  payer: TransactionSigner;
  index: bigint | number;
  transactionMessageBytes: Uint8Array;
  creator: TransactionSigner | Secp256r1Key;
  bufferIndex?: number;
  executor?: TransactionSigner | Secp256r1Key;
  additionalVoters?: (TransactionSigner | Secp256r1Key)[];
  additionalSigners?: TransactionSigner[];
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  jitoBundlesTipAmount?: number;
  chunkSize?: number;
  compressed?: boolean;
}

export async function prepareTransactionBundle({
  payer,
  index,
  transactionMessageBytes,
  creator,
  executor,
  secp256r1VerifyInput,
  jitoBundlesTipAmount,
  bufferIndex = Math.floor(Math.random() * 255),
  additionalVoters = [],
  additionalSigners = [],
  compressed = false,
  chunkSize = Math.ceil(transactionMessageBytes.length / 2),
}: CreateTransactionBundleArgs) {
  // --- Stage 1: Setup Addresses ---
  const [settings, transactionBufferAddress] = await Promise.all([
    getSettingsFromIndex(index),
    getTransactionBufferAddress(
      await getSettingsFromIndex(index),
      creator instanceof Secp256r1Key ? creator : creator.address,
      bufferIndex
    ),
  ]);

  // --- Stage 2: Split Transaction Message into chunks + hashing ---
  const chunks: Uint8Array[] = [];
  const chunksHash: Uint8Array[] = [];
  for (let i = 0; i < transactionMessageBytes.length; i += chunkSize) {
    const chunk = transactionMessageBytes.subarray(i, i + chunkSize);
    chunks.push(chunk);
    chunksHash.push(getHash(chunk));
  }
  const finalBufferHash = getHash(transactionMessageBytes);

  // --- Stage 3: Derive readonly compressed proof args if necessary---
  const { settingsReadonlyArgs, proof, packedAccounts } =
    await constructSettingsProofArgs(compressed, index);
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedArgs = settingsReadonlyArgs
    ? {
        settingsReadonlyArgs,
        compressedProofArgs: convertToCompressedProofArgs(proof, systemOffset),
        remainingAccounts,
        payer,
      }
    : null;

  // --- Stage 4: Instruction groups ---
  const createIxs = createTransactionBuffer({
    finalBufferHash,
    finalBufferSize: transactionMessageBytes.length,
    bufferIndex,
    payer,
    transactionBufferAddress,
    settings,
    creator,
    permissionlessExecution: !executor,
    bufferExtendHashes: chunksHash,
    compressedArgs,
  });

  const extendIxs = chunks.map((bytes) =>
    extendTransactionBuffer({
      transactionMessageBytes: bytes,
      transactionBufferAddress,
      settings,
      compressed,
    })
  );

  const voteIxs = additionalVoters.map((voter) =>
    voteTransactionBuffer({
      voter,
      transactionBufferAddress,
      settings,
      compressedArgs,
    })
  );

  const executeApprovalIxs = executeTransactionBuffer({
    compressedArgs,
    settings,
    executor,
    transactionBufferAddress,
  });

  const { instructions: executeIxs, addressLookupTableAccounts } =
    await executeTransaction({
      compressed,
      settings,
      transactionMessageBytes,
      transactionBufferAddress,
      payer,
      additionalSigners,
      secp256r1VerifyInput,
      jitoBundlesTipAmount,
    });

  // --- Stage 5: Assemble transactions ---
  const buildTx = (
    id: string,
    ixs: Instruction[]
  ): {
    id: string;
    payer: TransactionSigner;
    ixs: Instruction[];
    addressLookupTableAccounts?: AddressesByLookupTableAddress;
  } => ({
    id,
    payer,
    ixs,
    addressLookupTableAccounts,
  });

  const txs = [
    buildTx("Create Transaction Buffer", createIxs),
    ...extendIxs.map((ix) => buildTx("Extend Transaction Buffer", [ix])),
    ...(voteIxs.length ? [buildTx("Vote Transaction", voteIxs.flat())] : []),
    buildTx("Execute Transaction Approval", executeApprovalIxs),
    buildTx("Execute Transaction", executeIxs),
  ];

  return txs;
}
