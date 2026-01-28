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
import { sha256 } from "../utils/crypto";
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
    bufferIndex,
  );

  // --- Stage 2: Split Transaction Message into chunks + hashing ---
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const chunksHash: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < transactionMessageBytes.length; i += chunkSize) {
    const chunk = transactionMessageBytes.subarray(
      i,
      i + chunkSize,
    ) as Uint8Array<ArrayBuffer>;
    chunks.push(chunk);
    chunksHash.push(await sha256(chunk));
  }
  const finalBufferHash = await sha256(
    transactionMessageBytes as Uint8Array<ArrayBuffer>,
  );

  // --- Stage 3: Derive readonly compressed proof args if necessary---
  const { settingsReadonlyArgs, settingsMutArgs, proof, packedAccounts } =
    await constructSettingsProofArgs(
      compressed,
      index,
      settingsAddressTreeIndex,
      false,
      cachedAccounts,
    );
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedArgs =
    proof && settingsReadonlyArgs && settingsMutArgs
      ? {
          settingsReadonlyArgs,
          settingsMutArgs,
          compressedProofArgs: convertToCompressedProofArgs(
            proof,
            systemOffset,
          ),
          remainingAccounts,
          payer,
        }
      : null;

  // --- Stage 4: Instruction groups ---
  const expectedSecp256r1Signers = await Promise.all(
    getDeduplicatedSigners([
      creator,
      ...(executor ? [executor] : []),
      ...additionalVoters,
    ])
      .filter((x) => x instanceof SignedSecp256r1Key)
      .map(async (x) => ({
        memberKey: convertPubkeyToMemberkey(x),
        messageHash: await getSecp256r1MessageHash(x.authResponse),
      })),
  );

  const createIxs = await createTransactionBuffer({
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
    }),
  );

  const voteIxs = await Promise.all(
    additionalVoters.map((voter) =>
      voteTransactionBuffer({
        voter,
        transactionBufferAddress,
        settings,
        compressedArgs,
      }),
    ),
  );

  const executeApprovalIxs = await executeTransactionBuffer({
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
