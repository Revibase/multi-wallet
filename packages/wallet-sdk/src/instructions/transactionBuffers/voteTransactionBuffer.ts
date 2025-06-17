import { Address, IInstruction, TransactionSigner } from "@solana/kit";
import { getTransactionBufferVoteInstruction } from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

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
  const {
    instructionsSysvar,
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    signature,
    publicKey,
    message,
  } = await extractSecp256r1VerificationArgs(voter);

  const instructions: IInstruction[] = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([
        {
          message,
          signature,
          publicKey,
        },
      ])
    );
  }

  instructions.push(
    getTransactionBufferVoteInstruction({
      instructionsSysvar,
      slotHashSysvar,
      settings,
      transactionBuffer: transactionBufferAddress,
      payer: feePayer,
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      voter: voter instanceof Secp256r1Key ? undefined : voter,
    })
  );
  return instructions;
}
