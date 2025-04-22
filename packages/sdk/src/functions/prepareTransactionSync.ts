import {
  Address,
  AddressesByLookupTableAddress,
  IInstruction,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { executeTransactionSync } from "../methods";
import { Permission, Permissions, Secp256r1Key } from "../types";
import { getMemberKeyString } from "../utils";
import {
  deduplicateSignersAndFeePayer,
  getPubkeyString,
} from "../utils/private";
import { fetchSettingsData } from "./fetchSettingsData";

interface CreateTransactionSyncArgs {
  rpc: Rpc<SolanaRpcApi>;
  feePayer: TransactionSigner;
  settings: Address;
  transactionMessageBytes: Uint8Array;
  signers: (TransactionSigner | Secp256r1Key)[];
  skipChecks?: boolean;
}

export async function prepareTransactionSync({
  rpc,
  feePayer,
  settings,
  transactionMessageBytes,
  signers,
  skipChecks = false,
}: CreateTransactionSyncArgs): Promise<{
  id: string;
  signers: Address[];
  feePayer: TransactionSigner;
  ixs: IInstruction[];
  addressLookupTableAccounts?: AddressesByLookupTableAddress;
}> {
  if (!skipChecks) {
    await preTransactionChecks(rpc, settings, signers);
  }

  const { transactionExecuteSyncIx: ix, addressLookupTableAccounts } =
    await executeTransactionSync({
      rpc,
      settings,
      signers,
      transactionMessageBytes,
    });

  return {
    id: "Execute Transaction Sync",
    signers: deduplicateSignersAndFeePayer(ix, feePayer),
    feePayer,
    ixs: [ix],
    addressLookupTableAccounts,
  };
}
async function preTransactionChecks(
  rpc: Rpc<SolanaRpcApi>,
  settings: Address,
  signers: (TransactionSigner | Secp256r1Key)[]
) {
  const settingsData = await fetchSettingsData(rpc, settings);

  if (!settingsData) {
    throw new Error("Unable to fetch settings data");
  }

  const creatorMember = settingsData.members.some(
    (x) =>
      Permissions.has(x.permissions, Permission.InitiateTransaction) &&
      signers.some((y) => getPubkeyString(y) === getMemberKeyString(x.pubkey))
  );

  if (!creatorMember) {
    throw new Error(
      "Signers does not contain any member with initiate transaction permission."
    );
  }

  const executorMember = settingsData.members.find(
    (x) =>
      Permissions.has(x.permissions, Permission.ExecuteTransaction) &&
      signers.some((y) => getPubkeyString(y) === getMemberKeyString(x.pubkey))
  );

  if (!executorMember) {
    throw new Error(
      "Signers does not contain any member with execute transaction permission."
    );
  }

  const votingMembers = settingsData.members.filter(
    (x) =>
      Permissions.has(x.permissions, Permission.VoteTransaction) &&
      signers.some((y) => getPubkeyString(y) === getMemberKeyString(x.pubkey))
  );

  if (votingMembers.length < settingsData.threshold) {
    throw new Error("Insufficient signers with vote transaction permission.");
  }
}
