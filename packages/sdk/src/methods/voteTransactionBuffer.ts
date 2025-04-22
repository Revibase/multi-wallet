import { Address, TransactionSigner } from "@solana/kit";
import { getTransactionBufferVoteInstruction } from "../generated";
import { Secp256r1Key } from "../types";
import { extractSecp256r1VerificationArgs } from "../utils/private";

export async function voteTransactionBuffer({
  feePayer,
  settings,
  voter,
  transactionBufferAddress,
}: {
  feePayer: TransactionSigner;
  settings: Address;
  voter: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: Address;
}) {
  const { slotHashSysvar, domainConfig, verifyArgs } =
    extractSecp256r1VerificationArgs(voter);

  return getTransactionBufferVoteInstruction({
    slotHashSysvar,
    settings,
    transactionBuffer: transactionBufferAddress,
    payer: feePayer,
    secp256r1VerifyArgs: verifyArgs,
    domainConfig,
    voter: voter instanceof Secp256r1Key ? undefined : voter,
  });
}
