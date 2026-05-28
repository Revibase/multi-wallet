import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { getTransactionBufferVoteInstruction } from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export function voteTransactionBuffer({
  settings,
  voter,
  transactionBufferAddress,
}: {
  settings: Address;
  voter: TransactionSigner | SignedSecp256r1Key;
  transactionBufferAddress: Address;
}) {
  const { domainConfig, verifyArgs, signature, publicKey, message } =
    extractSecp256r1VerificationArgs(voter);
  const instructions: Instruction[] = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([
        {
          message,
          signature,
          publicKey,
        },
      ]),
    );
  }

  instructions.push(
    getTransactionBufferVoteInstruction({
      settings,
      transactionBuffer: transactionBufferAddress,
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      voter: voter instanceof SignedSecp256r1Key ? undefined : voter,
      remainingAccounts: [],
    }),
  );

  return instructions;
}
