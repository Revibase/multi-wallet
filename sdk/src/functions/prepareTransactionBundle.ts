import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  addJitoTip,
  createTransactionBuffer,
  executeTransactionBuffer,
  voteTransactionBuffer,
} from "../instructions";
import { Permission, Permissions, Secp256r1Key } from "../types";
import {
  ADDRESS_LOOK_UP_TABLE,
  getTransactionBufferAddress,
  isEquals,
  isPublicKey,
  simulateTransaction,
} from "../utils";
import { fetchSettingsData } from "./fetchSettingsData";
import { prepareTransactionMessage } from "./prepareTransactionMessage";

interface CreateTransactionBundleArgs {
  connection: Connection;
  feePayer: PublicKey;
  instructions: TransactionInstruction[];
  settings: PublicKey;
  creator: PublicKey | Secp256r1Key;
  executor: PublicKey | Secp256r1Key;
  additionalVoters?: (PublicKey | Secp256r1Key)[];
  jitoBundlesTipAmount?: number;
  lookUpTables?: AddressLookupTableAccount[];
}

export async function prepareTransactionBundle({
  connection,
  feePayer,
  instructions,
  settings,
  creator,
  executor,
  additionalVoters = [],
  lookUpTables,
  jitoBundlesTipAmount,
}: CreateTransactionBundleArgs) {
  const settingsData = await fetchSettingsData(connection, settings);

  if (!settingsData) {
    throw new Error("Unable to fetch settings data");
  }

  const threshold = settingsData.threshold;

  let votes = 0;

  const creatorMember = settingsData.members.find(
    (x) =>
      isEquals(creator, x.pubkey) &&
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
      isEquals(executor, x.pubkey) &&
      Permissions.has(x.permissions, Permission.ExecuteTransaction)
  );

  if (!executorMember) {
    throw new Error("Executor does not have execute transaction permission.");
  }

  if (
    !(
      executorMember.pubkey.key.equals(creatorMember.pubkey.key) &&
      executorMember.pubkey.keyType === creatorMember.pubkey.keyType
    ) &&
    Permissions.has(executorMember.permissions, Permission.VoteTransaction)
  ) {
    votes += 1;
  }

  let uniqueVoters: (PublicKey | Secp256r1Key)[] = [];
  if (votes < threshold) {
    uniqueVoters = additionalVoters
      .filter(
        (x) =>
          x.toBase58() !== creator.toBase58() &&
          x.toBase58() !== executor.toBase58()
      )
      .filter((x) =>
        settingsData.members.some(
          (y) =>
            isEquals(x, y.pubkey) &&
            Permissions.has(y.permissions, Permission.VoteTransaction)
        )
      );
  }

  votes += uniqueVoters.length;

  if (votes < threshold) {
    throw new Error("Insufficient voters with vote transaction permission.");
  }

  const simulation = await simulateTransaction(
    connection,
    instructions,
    feePayer,
    lookUpTables,
    true,
    false,
    true
  );

  if (simulation.value.err)
    throw new Error(`${JSON.stringify(simulation.value)}`);

  const { compiledMessage, transactionMessage, transactionMessageBytes } =
    prepareTransactionMessage(instructions, feePayer, lookUpTables);

  const bufferIndex = Math.round(Math.random() * 255);

  const transactionBufferAddress = getTransactionBufferAddress(
    settings,
    creator,
    bufferIndex
  );

  const { transactionBufferExtendIx, transactionBufferIx } =
    await createTransactionBuffer({
      connection,
      transactionMessageBytes,
      bufferIndex,
      feePayer,
      transactionBufferAddress,
      settings,
      creator,
    });

  let transactionVoteIxs: TransactionInstruction[] = [];
  if (uniqueVoters.length > 0) {
    transactionVoteIxs = await Promise.all(
      uniqueVoters.map((voter) =>
        voteTransactionBuffer({
          feePayer,
          voter,
          transactionBufferAddress,
          settings,
          transactionMessageBytes,
          connection,
        })
      )
    );
  }

  const { transactionBufferExecuteIx, lookupTableAccounts } =
    await executeTransactionBuffer({
      connection,
      settings,
      executor,
      transactionBufferAddress,
      transactionMessage,
      transactionMessageBytes,
      compiledMessage,
      feePayer,
    });

  const addressLookUpTable = (
    await connection.getAddressLookupTable(ADDRESS_LOOK_UP_TABLE)
  ).value;
  const txs: {
    id: string;
    signers: PublicKey[];
    feePayer: PublicKey;
    ixs: TransactionInstruction[];
    lookupTableAccounts?: AddressLookupTableAccount[];
  }[] = [];

  txs.push({
    id: "Create Transaction Buffer",
    signers: transactionBufferIx.keys
      .filter((x) => x.isSigner)
      .map((x) => x.pubkey),
    feePayer,
    ixs: [transactionBufferIx],
  });

  if (transactionBufferExtendIx) {
    txs.push({
      id: "Extend Transaction Buffer",
      signers: transactionBufferExtendIx.keys
        .filter((x) => x.isSigner)
        .map((x) => x.pubkey),
      feePayer,
      ixs: [transactionBufferExtendIx],
    });
  }

  if (transactionVoteIxs.length > 0) {
    txs.push({
      id: "Vote Transaction",
      signers: uniqueVoters
        .filter((x) => isPublicKey(x) && x.toBase58() !== feePayer.toBase58())
        .map((x) => new PublicKey(x))
        .concat([feePayer]),
      feePayer,
      ixs: transactionVoteIxs,
    });
  }

  txs.push({
    id: "Execute Transaction",
    signers: transactionBufferExecuteIx.keys
      .filter((x) => x.isSigner)
      .map((x) => x.pubkey),
    feePayer,
    ixs: [transactionBufferExecuteIx].concat(
      jitoBundlesTipAmount
        ? [
            await addJitoTip({
              feePayer,
              tipAmount: jitoBundlesTipAmount,
            }),
          ]
        : []
    ),
    lookupTableAccounts: lookupTableAccounts.concat(addressLookUpTable ?? []),
  });

  return txs;
}
