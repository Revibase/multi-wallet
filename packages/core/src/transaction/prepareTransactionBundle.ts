import { sha256 } from "@noble/hashes/sha2";
import type {
  AddressesByLookupTableAddress,
  Instruction,
  ReadonlyUint8Array,
  TransactionSigner,
} from "gill";
import {
  createTransactionBuffer,
  executeTransaction,
  executeTransactionBuffer,
  extendTransactionBuffer,
  voteTransactionBuffer,
  type Secp256r1VerifyInput,
} from "../instructions";
import { SignedSecp256r1Key } from "../types";
import type { TransactionDetails } from "../types/transaction";
import {
  getSecp256r1MessageHash,
  getSettingsFromIndex,
  getTransactionBufferAddress,
} from "../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../utils/compressed/internal";
import {
  convertPubkeyToMemberkey,
  getDeduplicatedSigners,
} from "../utils/transaction/internal";

interface CreateTransactionBundleArgs {
  payer: TransactionSigner;
  index: number | bigint;
  settingsAddressTreeIndex?: number;
  transactionMessageBytes: ReadonlyUint8Array;
  creator: TransactionSigner | SignedSecp256r1Key;
  additionalVoters?: (TransactionSigner | SignedSecp256r1Key)[];
  executor?: TransactionSigner | SignedSecp256r1Key;
  additionalSigners?: TransactionSigner[];
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  jitoBundlesTipAmount?: number;
  compressed?: boolean;
  chunkSize?: number;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  cachedAccounts?: Map<string, any>;
}

export async function prepareTransactionBundle({
  payer,
  index,
  settingsAddressTreeIndex,
  transactionMessageBytes,
  creator,
  executor,
  secp256r1VerifyInput,
  jitoBundlesTipAmount,
  addressesByLookupTableAddress,
  compressed = false,
  additionalVoters = [],
  additionalSigners = [],
  chunkSize = Math.ceil(transactionMessageBytes.length / 2),
  cachedAccounts,
}: CreateTransactionBundleArgs): Promise<TransactionDetails[]> {
  // --- Stage 1: Setup Addresses ---
  const settings = await getSettingsFromIndex(index);

  const bufferIndex = Math.floor(Math.random() * 255);
  const transactionBufferAddress = await getTransactionBufferAddress(
    settings,
    creator instanceof SignedSecp256r1Key ? creator : creator.address,
    bufferIndex
  );

  // --- Stage 2: Split Transaction Message into chunks + hashing ---
  const chunks: Uint8Array[] = [];
  const chunksHash: Uint8Array[] = [];
  for (let i = 0; i < transactionMessageBytes.length; i += chunkSize) {
    const chunk = transactionMessageBytes.subarray(i, i + chunkSize);
    chunks.push(chunk);
    chunksHash.push(sha256(chunk));
  }
  const finalBufferHash = sha256(new Uint8Array(transactionMessageBytes));

  // --- Stage 3: Derive readonly compressed proof args if necessary---
  const { settingsReadonlyArgs, proof, packedAccounts } =
    await constructSettingsProofArgs(
      compressed,
      index,
      settingsAddressTreeIndex,
      false,
      cachedAccounts
    );
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
  const expectedSecp256r1Signers = getDeduplicatedSigners([
    creator,
    ...(executor ? [executor] : []),
    ...additionalVoters,
  ])
    .filter((x) => x instanceof SignedSecp256r1Key)
    .map((x) => ({
      memberKey: convertPubkeyToMemberkey(x),
      messageHash: getSecp256r1MessageHash(x.authResponse),
    }));

  const createIxs = createTransactionBuffer({
    finalBufferHash,
    finalBufferSize: transactionMessageBytes.length,
    bufferIndex,
    payer,
    transactionBufferAddress,
    settings,
    creator,
    preauthorizeExecution: !executor,
    bufferExtendHashes: chunksHash,
    compressedArgs,
    expectedSecp256r1Signers,
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
      addressesByLookupTableAddress,
    });

  // --- Stage 5: Assemble transactions ---
  const buildTx = (instructions: Instruction[]): TransactionDetails => ({
    payer,
    instructions,
    addressesByLookupTableAddress: addressLookupTableAccounts,
  });

  const txs = [
    buildTx(createIxs),
    ...extendIxs.map((ix) => buildTx([ix])),
    ...(voteIxs.length ? [buildTx(voteIxs.flat())] : []),
    buildTx(executeApprovalIxs),
    buildTx(executeIxs),
  ];

  return txs;
}
