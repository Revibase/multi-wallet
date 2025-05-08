import {
  address,
  AddressesByLookupTableAddress,
  GetAccountInfoApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { fetchMaybeSettings } from "../generated";
import { executeTransactionSync } from "../instructions";
import { Permission, Permissions, Secp256r1Key } from "../types";
import { convertMemberKeyToString } from "../utils";
import {
  deduplicateSignersAndFeePayer,
  getPubkeyString,
} from "../utils/internal";

interface CreateTransactionSyncArgs {
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;
  feePayer: TransactionSigner;
  settings: string;
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
  signers: string[];
  feePayer: TransactionSigner;
  ixs: IInstruction[];
  addressLookupTableAccounts?: AddressesByLookupTableAddress;
}> {
  if (!skipChecks) {
    await preTransactionChecks(rpc, settings, signers);
  }

  const { transactionExecuteSyncIx, addressLookupTableAccounts } =
    await executeTransactionSync({
      rpc,
      settings,
      signers,
      transactionMessageBytes,
    });

  return {
    id: "Execute Transaction Sync",
    signers: deduplicateSignersAndFeePayer(transactionExecuteSyncIx, feePayer),
    feePayer,
    ixs: [transactionExecuteSyncIx],
    addressLookupTableAccounts,
  };
}
async function preTransactionChecks(
  rpc: Rpc<GetAccountInfoApi>,
  settings: string,
  signers: (TransactionSigner | Secp256r1Key)[]
) {
  const settingsData = await fetchMaybeSettings(rpc, address(settings));

  if (!settingsData.exists) {
    throw new Error("Unable to fetch settings data");
  }

  const creatorMember = settingsData.data.members.some(
    (x) =>
      Permissions.has(x.permissions, Permission.InitiateTransaction) &&
      signers.some(
        (y) => getPubkeyString(y) === convertMemberKeyToString(x.pubkey)
      )
  );

  if (!creatorMember) {
    throw new Error(
      "Signers does not contain any member with initiate transaction permission."
    );
  }

  const executorMember = settingsData.data.members.find(
    (x) =>
      Permissions.has(x.permissions, Permission.ExecuteTransaction) &&
      signers.some(
        (y) => getPubkeyString(y) === convertMemberKeyToString(x.pubkey)
      )
  );

  if (!executorMember) {
    throw new Error(
      "Signers does not contain any member with execute transaction permission."
    );
  }

  const votingMembers = settingsData.data.members.filter(
    (x) =>
      Permissions.has(x.permissions, Permission.VoteTransaction) &&
      signers.some(
        (y) => getPubkeyString(y) === convertMemberKeyToString(x.pubkey)
      )
  );

  if (votingMembers.length < settingsData.data.threshold) {
    throw new Error("Insufficient signers with vote transaction permission.");
  }
}
