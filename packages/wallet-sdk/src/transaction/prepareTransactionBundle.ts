import {
  Address,
  address,
  AddressesByLookupTableAddress,
  GetAccountInfoApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { fetchMaybeSettings } from "../generated";
import {
  createTransactionBuffer,
  executeTransaction,
  executeTransactionBuffer,
  extendTransactionBuffer,
  voteTransactionBuffer,
} from "../instructions";
import { Permission, Permissions, Secp256r1Key } from "../types";
import {
  convertMemberKeyToString,
  getTransactionBufferAddress,
} from "../utils";
import {
  addJitoTip,
  deduplicateSignersAndFeePayer,
  getPubkeyString,
} from "../utils/internal";

interface CreateTransactionBundleArgs {
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;
  feePayer: TransactionSigner;
  settings: Address;
  bufferIndex: number;
  transactionMessageBytes: Uint8Array;
  creator: TransactionSigner | Secp256r1Key;
  executor?: TransactionSigner | Secp256r1Key;
  additionalVoters?: (TransactionSigner | Secp256r1Key)[];
  additionalSigners?: TransactionSigner[];
  jitoBundlesTipAmount?: number;
  skipChecks?: boolean;
  createChunkSize?: number;
  extendChunkSize?: number;
}

export async function prepareTransactionBundle({
  rpc,
  feePayer,
  settings,
  bufferIndex,
  transactionMessageBytes,
  creator,
  executor,
  additionalVoters = [],
  additionalSigners = [],
  jitoBundlesTipAmount,
  skipChecks = false,
  createChunkSize = 400,
  extendChunkSize = 832,
}: CreateTransactionBundleArgs): Promise<
  {
    id: string;
    signers: string[];
    feePayer: TransactionSigner;
    ixs: IInstruction[];
    addressLookupTableAccounts?: AddressesByLookupTableAddress;
  }[]
> {
  if (!skipChecks) {
    await preTransactionChecks(
      rpc,
      settings,
      creator,
      additionalVoters,
      executor
    );
  }

  const transactionBufferAddress = await getTransactionBufferAddress(
    settings,
    creator instanceof Secp256r1Key ? creator : creator.address,
    bufferIndex
  );

  const finalBufferHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", transactionMessageBytes)
  );

  const finalBufferSize = transactionMessageBytes.length;

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
    feePayer,
    transactionBufferAddress,
    settings,
    creator,
    permissionlessExecution: !executor,
    bufferExtendHashes: extendChunksHash,
  });

  const transactionBufferExtendIxs = extendChunks.map((chunk) =>
    extendTransactionBuffer({
      transactionMessageBytes: chunk,
      transactionBufferAddress,
      settings,
    })
  );

  const transactionVoteIxs = await Promise.all(
    additionalVoters.map((voter) =>
      voteTransactionBuffer({
        feePayer,
        voter,
        transactionBufferAddress,
        settings,
      })
    )
  );

  const transactionBufferExecuteIxs = await executeTransactionBuffer({
    settings,
    executor,
    transactionBufferAddress,
  });

  const { transactionExecuteIx, addressLookupTableAccounts } =
    await executeTransaction({
      rpc,
      settings,
      transactionMessageBytes,
      transactionBufferAddress,
      feePayer,
      additionalSigners,
    });

  const txs = [];
  txs.push({
    id: "Create Transaction Buffer",
    signers: deduplicateSignersAndFeePayer(
      transactionBufferCreateIxs,
      feePayer
    ),
    feePayer,
    ixs: transactionBufferCreateIxs,
  });

  txs.push(
    ...transactionBufferExtendIxs.map((transactionBufferExtendIx) => ({
      id: "Extend Transaction Buffer",
      signers: deduplicateSignersAndFeePayer(
        [transactionBufferExtendIx],
        feePayer
      ),
      feePayer,
      ixs: [transactionBufferExtendIx],
    }))
  );

  if (transactionVoteIxs.length > 0) {
    txs.push({
      id: "Vote Transaction",
      signers: additionalVoters
        .filter(
          (x) =>
            !(x instanceof Secp256r1Key) &&
            getPubkeyString(x) !== feePayer.address.toString()
        )
        .map((x) => address(getPubkeyString(x)))
        .concat([feePayer.address]),
      feePayer,
      ixs: transactionVoteIxs.flatMap((x) => ({ ...x })),
    });
  }

  txs.push({
    id: "Execute Transaction Approval",
    signers: deduplicateSignersAndFeePayer(
      transactionBufferExecuteIxs,
      feePayer
    ),
    feePayer,
    ixs: transactionBufferExecuteIxs,
  });

  txs.push({
    id: "Execute Transaction",
    signers: deduplicateSignersAndFeePayer([transactionExecuteIx], feePayer),
    feePayer,
    ixs: [
      transactionExecuteIx,
      ...(jitoBundlesTipAmount
        ? [addJitoTip({ feePayer, tipAmount: jitoBundlesTipAmount })]
        : []),
    ],
    addressLookupTableAccounts,
  });

  return txs;
}

async function preTransactionChecks(
  rpc: Rpc<GetAccountInfoApi>,
  settings: Address,
  creator: TransactionSigner | Secp256r1Key,
  additionalVoters: (TransactionSigner | Secp256r1Key)[],
  executor?: TransactionSigner | Secp256r1Key
) {
  const settingsData = await fetchMaybeSettings(rpc, settings);

  if (!settingsData.exists) {
    throw new Error("Unable to fetch settings data");
  }

  let votes = 0;

  const creatorMember = settingsData.data.members.find(
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

  const executorMember = settingsData.data.members.find(
    (x) =>
      getPubkeyString(executor ?? creator) ===
        convertMemberKeyToString(x.pubkey) &&
      Permissions.has(x.permissions, Permission.ExecuteTransaction)
  );

  if (!executorMember) {
    throw new Error(
      `${executor ? "Executor" : "Creator"} does not have execute transaction permission.`
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
      settingsData.data.members.some(
        (y) =>
          getPubkeyString(x) === convertMemberKeyToString(y.pubkey) &&
          Permissions.has(y.permissions, Permission.VoteTransaction)
      )
    ).length;

  if (votes < settingsData.data.threshold) {
    throw new Error("Insufficient voters with vote transaction permission.");
  }
}
