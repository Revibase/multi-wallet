import {
  Address,
  address,
  AddressesByLookupTableAddress,
  IInstruction,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import {
  addJitoTip,
  createTransactionBuffer,
  executeTransactionBuffer,
  voteTransactionBuffer,
} from "../methods";
import { Permission, Permissions, Secp256r1Key } from "../types";
import { getMemberKeyString, getTransactionBufferAddress } from "../utils";
import {
  deduplicateSignersAndFeePayer,
  getPubkeyString,
} from "../utils/private";
import { fetchSettingsData } from "./fetchSettingsData";

interface CreateTransactionBundleArgs {
  rpc: Rpc<SolanaRpcApi>;
  feePayer: TransactionSigner;
  settings: Address;
  bufferIndex: number;
  transactionMessageBytes: Uint8Array;
  creator: TransactionSigner | Secp256r1Key;
  executor: TransactionSigner | Secp256r1Key;
  additionalVoters?: (TransactionSigner | Secp256r1Key)[];
  additionalSigners?: TransactionSigner[];
  jitoBundlesTipAmount?: number;
  skipChecks?: boolean;
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
}: CreateTransactionBundleArgs): Promise<
  {
    id: string;
    signers: Address[];
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
      executor,
      additionalVoters
    );
  }

  const transactionBufferAddress = await getTransactionBufferAddress(
    settings,
    creator,
    bufferIndex
  );

  const { transactionBufferCreateIx, transactionBufferExtendIx } =
    await createTransactionBuffer({
      transactionMessageBytes,
      bufferIndex,
      feePayer,
      transactionBufferAddress,
      settings,
      creator,
    });

  let transactionVoteIxs: IInstruction[] = [];
  if (additionalVoters.length > 0) {
    transactionVoteIxs = await Promise.all(
      additionalVoters.map((voter) =>
        voteTransactionBuffer({
          feePayer,
          voter,
          transactionBufferAddress,
          settings,
        })
      )
    );
  }

  const { transactionBufferExecuteIx, addressLookupTableAccounts } =
    await executeTransactionBuffer({
      rpc,
      settings,
      executor,
      transactionBufferAddress,
      transactionMessageBytes,
      feePayer,
      additionalSigners,
    });

  const txs = [];
  txs.push({
    id: "Create Transaction Buffer",
    signers: deduplicateSignersAndFeePayer(transactionBufferCreateIx, feePayer),
    feePayer,
    ixs: [transactionBufferCreateIx],
  });

  if (transactionBufferExtendIx) {
    txs.push({
      id: "Extend Transaction Buffer",
      signers: deduplicateSignersAndFeePayer(
        transactionBufferExtendIx,
        feePayer
      ),
      feePayer,
      ixs: [transactionBufferExtendIx],
    });
  }

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
      ixs: transactionVoteIxs,
    });
  }

  txs.push({
    id: "Execute Transaction",
    signers: deduplicateSignersAndFeePayer(
      transactionBufferExecuteIx,
      feePayer
    ),
    feePayer,
    ixs: [
      transactionBufferExecuteIx,
      ...(jitoBundlesTipAmount
        ? [
            await addJitoTip({
              feePayer,
              tipAmount: jitoBundlesTipAmount,
            }),
          ]
        : []),
    ],
    addressLookupTableAccounts: addressLookupTableAccounts,
  });

  return txs;
}

async function preTransactionChecks(
  rpc: Rpc<SolanaRpcApi>,
  settings: Address,
  creator: TransactionSigner | Secp256r1Key,
  executor: TransactionSigner | Secp256r1Key,
  additionalVoters: (TransactionSigner | Secp256r1Key)[]
) {
  const settingsData = await fetchSettingsData(rpc, settings);

  if (!settingsData) {
    throw new Error("Unable to fetch settings data");
  }

  let votes = 0;

  const creatorMember = settingsData.members.find(
    (x) =>
      getPubkeyString(creator) === getMemberKeyString(x.pubkey) &&
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
      getPubkeyString(executor) === getMemberKeyString(x.pubkey) &&
      Permissions.has(x.permissions, Permission.ExecuteTransaction)
  );

  if (!executorMember) {
    throw new Error("Executor does not have execute transaction permission.");
  }

  if (
    !(
      getMemberKeyString(executorMember.pubkey) ===
      getMemberKeyString(creatorMember.pubkey)
    ) &&
    Permissions.has(executorMember.permissions, Permission.VoteTransaction)
  ) {
    votes += 1;
  }

  votes += additionalVoters
    .filter(
      (x) =>
        getPubkeyString(x) !== getPubkeyString(creator) &&
        getPubkeyString(x) !== getPubkeyString(executor)
    )
    .filter((x) =>
      settingsData.members.some(
        (y) =>
          getPubkeyString(x) === getMemberKeyString(y.pubkey) &&
          Permissions.has(y.permissions, Permission.VoteTransaction)
      )
    ).length;

  if (votes < settingsData.threshold) {
    throw new Error("Insufficient voters with vote transaction permission.");
  }
}
