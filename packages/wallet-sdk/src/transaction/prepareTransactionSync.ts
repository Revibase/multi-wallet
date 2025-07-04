import { TransactionSigner } from "@solana/kit";
import { fetchSettingsData } from "../compressed";
import { executeTransactionSync, Secp256r1VerifyInput } from "../instructions";
import { Permission, Permissions, Secp256r1Key } from "../types";
import { convertMemberKeyToString } from "../utils";
import {
  deduplicateSignersAndFeePayer,
  getPubkeyString,
} from "../utils/internal";

interface CreateTransactionSyncArgs {
  payer: TransactionSigner;
  index: bigint | number;
  transactionMessageBytes: Uint8Array;
  signers: (TransactionSigner | Secp256r1Key)[];
  skipChecks?: boolean;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
}

export async function prepareTransactionSync({
  payer,
  index,
  transactionMessageBytes,
  signers,
  skipChecks = false,
  secp256r1VerifyInput,
  compressed = false,
}: CreateTransactionSyncArgs) {
  if (!skipChecks) {
    await preTransactionChecks(index, signers);
  }
  const { instructions, addressLookupTableAccounts } =
    await executeTransactionSync({
      compressed,
      payer: payer,
      index,
      signers,
      transactionMessageBytes,
      secp256r1VerifyInput,
    });

  return {
    id: "Execute Transaction Sync",
    signers: deduplicateSignersAndFeePayer(instructions, payer),
    payer,
    ixs: instructions,
    addressLookupTableAccounts,
  };
}
async function preTransactionChecks(
  index: bigint | number,
  signers: (TransactionSigner | Secp256r1Key)[]
) {
  const settingsData = await fetchSettingsData(index);

  const creatorMember = settingsData.members.some(
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

  const executorMember = settingsData.members.find(
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

  const votingMembers = settingsData.members.filter(
    (x) =>
      Permissions.has(x.permissions, Permission.VoteTransaction) &&
      signers.some(
        (y) => getPubkeyString(y) === convertMemberKeyToString(x.pubkey)
      )
  );

  if (votingMembers.length < settingsData.threshold) {
    throw new Error("Insufficient signers with vote transaction permission.");
  }
}
