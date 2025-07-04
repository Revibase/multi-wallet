import {
  address,
  assertIsTransactionMessageWithBlockhashLifetime,
  CompiledTransactionMessage,
  compileTransaction,
  decompileTransactionMessageFetchingLookupTables,
  getBase64EncodedWireTransaction,
  IInstruction,
  TransactionSigner,
} from "@solana/kit";
import { fetchSettingsData } from "../compressed";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../generated";
import {
  createTransactionBuffer,
  executeTransaction,
  executeTransactionBuffer,
  extendTransactionBuffer,
  getSecp256r1VerifyInstruction,
  Secp256r1VerifyInput,
  voteTransactionBuffer,
} from "../instructions";
import { Permission, Permissions, Secp256r1Key } from "../types";
import {
  convertMemberKeyToString,
  customTransactionMessageDeserialize,
  getSettingsFromIndex,
  getSolanaRpc,
  getTransactionBufferAddress,
} from "../utils";
import {
  deduplicateSignersAndFeePayer,
  getPubkeyString,
} from "../utils/internal";

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
  skipChecks?: boolean;
  createChunkSize?: number;
  extendChunkSize?: number;
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
  skipChecks = false,
  compressed = false,
  createChunkSize = 100,
  extendChunkSize,
}: CreateTransactionBundleArgs) {
  if (!skipChecks) {
    await Promise.all([
      preTransactionChecks(index, creator, additionalVoters, executor),
      simulateTransactionCheck(transactionMessageBytes, secp256r1VerifyInput),
    ]);
  }

  const settings = await getSettingsFromIndex(index);
  const transactionBufferAddress = await getTransactionBufferAddress(
    settings,
    creator instanceof Secp256r1Key ? creator : creator.address,
    bufferIndex
  );

  const finalBufferHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", transactionMessageBytes)
  );

  const finalBufferSize = transactionMessageBytes.length;
  extendChunkSize =
    extendChunkSize ?? (compressed ? Math.ceil(finalBufferSize / 2) : 900);
  const createChunk = transactionMessageBytes.subarray(0, createChunkSize);
  const extendChunks: Uint8Array[] = [];
  const extendChunksHash: Uint8Array[] = [];
  for (
    let i = createChunkSize;
    i < transactionMessageBytes.length;
    i += extendChunkSize
  ) {
    const extendChunk = transactionMessageBytes.subarray(
      i,
      i + extendChunkSize
    );
    extendChunks.push(extendChunk);
    extendChunksHash.push(
      new Uint8Array(await crypto.subtle.digest("SHA-256", extendChunk))
    );
  }

  const transactionBufferCreateIxs = await createTransactionBuffer({
    finalBufferHash,
    finalBufferSize,
    transactionMessageBytes: createChunk,
    bufferIndex,
    payer,
    transactionBufferAddress,
    index,
    creator,
    permissionlessExecution: !executor,
    bufferExtendHashes: extendChunksHash,
    compressed,
  });

  const transactionBufferExtendIxs = await Promise.all(
    extendChunks.map(
      async (chunk) =>
        await extendTransactionBuffer({
          transactionMessageBytes: chunk,
          transactionBufferAddress,
          index,
          payer,
          compressed,
        })
    )
  );

  const transactionVoteIxs = await Promise.all(
    additionalVoters.map((voter) =>
      voteTransactionBuffer({
        voter,
        transactionBufferAddress,
        index,
        compressed,
        payer,
      })
    )
  );

  const transactionBufferExecuteIxs = await executeTransactionBuffer({
    compressed,
    payer,
    index,
    executor,
    transactionBufferAddress,
  });

  const { instructions: transactionExecuteIx, addressLookupTableAccounts } =
    await executeTransaction({
      compressed,
      index,
      transactionMessageBytes,
      transactionBufferAddress,
      payer,
      additionalSigners,
      secp256r1VerifyInput,
      jitoBundlesTipAmount,
    });

  const txs = [];
  txs.push({
    id: "Create Transaction Buffer",
    signers: deduplicateSignersAndFeePayer(transactionBufferCreateIxs, payer),
    payer,
    ixs: transactionBufferCreateIxs,
    addressLookupTableAccounts,
  });

  txs.push(
    ...transactionBufferExtendIxs.map((transactionBufferExtendIx) => ({
      id: "Extend Transaction Buffer",
      signers: deduplicateSignersAndFeePayer(
        [transactionBufferExtendIx],
        payer
      ),
      payer,
      ixs: [transactionBufferExtendIx],
      addressLookupTableAccounts,
    }))
  );

  if (transactionVoteIxs.length > 0) {
    txs.push({
      id: "Vote Transaction",
      signers: additionalVoters
        .filter(
          (x) =>
            !(x instanceof Secp256r1Key) &&
            getPubkeyString(x) !== payer.address.toString()
        )
        .map((x) => address(getPubkeyString(x)))
        .concat([payer.address]),
      payer,
      ixs: transactionVoteIxs.flatMap((x) => ({ ...x })),
      addressLookupTableAccounts,
    });
  }

  txs.push({
    id: "Execute Transaction Approval",
    signers: deduplicateSignersAndFeePayer(transactionBufferExecuteIxs, payer),
    payer,
    ixs: transactionBufferExecuteIxs,
    addressLookupTableAccounts,
  });

  txs.push({
    id: "Execute Transaction",
    signers: deduplicateSignersAndFeePayer(transactionExecuteIx, payer),
    payer,
    ixs: transactionExecuteIx,
    addressLookupTableAccounts,
  });

  return txs;
}

async function preTransactionChecks(
  index: bigint | number,
  creator: TransactionSigner | Secp256r1Key,
  additionalVoters: (TransactionSigner | Secp256r1Key)[],
  executor?: TransactionSigner | Secp256r1Key
) {
  const settingsData = await fetchSettingsData(index);

  let votes = 0;

  const creatorMember = settingsData.members.find(
    (x) =>
      getPubkeyString(creator) === convertMemberKeyToString(x.pubkey) &&
      Permissions.has(x.permissions, Permission.InitiateTransaction)
  );

  if (!creatorMember) {
    throw new Error("Creator does not have initiate transaction permission.");
  }

  if (Permissions.has(creatorMember.permissions, Permission.VoteTransaction)) {
    votes += 1;
  }

  const executorMember = settingsData.members.find(
    (x) =>
      getPubkeyString(executor ?? creator) ===
        convertMemberKeyToString(x.pubkey) &&
      Permissions.has(x.permissions, Permission.ExecuteTransaction)
  );

  if (!executorMember) {
    throw new Error(
      `${
        executor ? "Executor" : "Creator"
      } does not have execute transaction permission.`
    );
  }

  if (
    !(
      convertMemberKeyToString(executorMember.pubkey) ===
      convertMemberKeyToString(creatorMember.pubkey)
    ) &&
    Permissions.has(executorMember.permissions, Permission.VoteTransaction)
  ) {
    votes += 1;
  }

  votes += additionalVoters
    .filter(
      (x) =>
        getPubkeyString(x) !== getPubkeyString(creator) &&
        getPubkeyString(x) !== getPubkeyString(executor ?? creator)
    )
    .filter((x) =>
      settingsData.members.some(
        (y) =>
          getPubkeyString(x) === convertMemberKeyToString(y.pubkey) &&
          Permissions.has(y.permissions, Permission.VoteTransaction)
      )
    ).length;

  if (votes < settingsData.threshold) {
    throw new Error("Insufficient voters with vote transaction permission.");
  }
}

export async function simulateTransactionCheck(
  transactionMessageBytes: Uint8Array,
  secp256r1VerifyInput?: Secp256r1VerifyInput
) {
  const customCompiledMessage = customTransactionMessageDeserialize(
    transactionMessageBytes
  );
  const compiledTransactionMessage: CompiledTransactionMessage = {
    header: {
      numSignerAccounts: customCompiledMessage.numSigners,
      numReadonlySignerAccounts:
        customCompiledMessage.numSigners -
        customCompiledMessage.numWritableSigners,
      numReadonlyNonSignerAccounts:
        customCompiledMessage.accountKeys.length -
        customCompiledMessage.numSigners -
        customCompiledMessage.numWritableNonSigners,
    },
    instructions: customCompiledMessage.instructions.map((x) => ({
      accountIndices: x.accountIndexes,
      programAddressIndex: x.programIdIndex,
      data: new Uint8Array(x.data),
    })),
    lifetimeToken: MULTI_WALLET_PROGRAM_ADDRESS.toString(),
    staticAccounts: customCompiledMessage.accountKeys,
    version: 0,
    addressTableLookups: customCompiledMessage.addressTableLookups.map((x) => ({
      ...x,
      lookupTableAddress: x.accountKey,
      writableIndices: x.writableIndexes,
      readableIndices: x.readonlyIndexes,
    })),
  };

  const decompiledTransactionMessage =
    await decompileTransactionMessageFetchingLookupTables(
      compiledTransactionMessage,
      getSolanaRpc()
    );

  assertIsTransactionMessageWithBlockhashLifetime(decompiledTransactionMessage);
  let instructions: IInstruction[] = [];
  if (secp256r1VerifyInput && secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }
  instructions.push(...decompiledTransactionMessage.instructions);

  const transaction = compileTransaction({
    instructions,
    feePayer: decompiledTransactionMessage.feePayer,
    lifetimeConstraint: decompiledTransactionMessage.lifetimeConstraint,
    version: decompiledTransactionMessage.version,
  });

  const {
    value: { err: transactionError, logs },
  } = await getSolanaRpc()
    .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
      replaceRecentBlockhash: true,
      sigVerify: false,
    })
    .send();
  if (transactionError) {
    throw new Error(
      JSON.stringify({ error: transactionError, logs }, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );
  }
}
