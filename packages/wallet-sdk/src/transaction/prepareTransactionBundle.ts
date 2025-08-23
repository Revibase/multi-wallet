import {
  Address,
  address,
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "@solana/kit";
import { fetchSettingsData } from "../compressed";
import {
  createTransactionBuffer,
  executeTransaction,
  executeTransactionBuffer,
  extendTransactionBuffer,
  Secp256r1VerifyInput,
  voteTransactionBuffer,
} from "../instructions";
import { Permission, Permissions, Secp256r1Key } from "../types";
import {
  convertMemberKeyToString,
  getSettingsFromIndex,
  getTransactionBufferAddress,
} from "../utils";
import {
  deduplicateSignersAndFeePayer,
  getHash,
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
  skipChecks = false,
  compressed = false,
  chunkSize = Math.ceil(transactionMessageBytes.length / 2),
}: CreateTransactionBundleArgs) {
  if (!skipChecks) {
    await preTransactionChecks(index, creator, additionalVoters, executor);
  }

  const settings = await getSettingsFromIndex(index);
  const transactionBufferAddress = await getTransactionBufferAddress(
    settings,
    creator instanceof Secp256r1Key ? creator : creator.address,
    bufferIndex
  );

  const finalBufferHash = getHash(transactionMessageBytes);

  const chunks: Uint8Array[] = [];
  const chunksHash: Uint8Array[] = [];
  for (let i = 0; i < transactionMessageBytes.length; i += chunkSize) {
    const chunk = transactionMessageBytes.subarray(i, i + chunkSize);
    chunks.push(chunk);
    chunksHash.push(getHash(chunk));
  }

  const transactionBufferCreateIxs = await createTransactionBuffer({
    finalBufferHash,
    finalBufferSize: transactionMessageBytes.length,
    bufferIndex,
    payer,
    transactionBufferAddress,
    index,
    creator,
    permissionlessExecution: !executor,
    bufferExtendHashes: chunksHash,
    compressed,
  });

  const transactionBufferExtendIxs = await Promise.all(
    chunks.map(
      async (transactionMessageBytes) =>
        await extendTransactionBuffer({
          transactionMessageBytes,
          transactionBufferAddress,
          index,
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

  const txs: {
    id: string;
    signers: Address[];
    payer: TransactionSigner;
    ixs: Instruction[];
    addressLookupTableAccounts?: AddressesByLookupTableAddress;
  }[] = [];
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
