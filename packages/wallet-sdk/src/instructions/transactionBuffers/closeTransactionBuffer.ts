import { Address, IInstruction, TransactionSigner } from "@solana/kit";
import { getTransactionBufferCloseInstruction } from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function closeTransactionBuffer({
  settings,
  feePayer,
  closer,
  transactionBufferAddress,
}: {
  feePayer: Address;
  settings: Address;
  closer: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: Address;
}) {
  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(closer);

  const instructions: IInstruction[] = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction({
        payload: [
          {
            message,
            signature,
            publicKey,
          },
        ],
      })
    );
  }

  instructions.push(
    getTransactionBufferCloseInstruction({
      instructionsSysvar,
      slotHashSysvar,
      transactionBuffer: transactionBufferAddress,
      domainConfig,
      closer: closer instanceof Secp256r1Key ? undefined : closer,
      settings,
      payer: feePayer,
      secp256r1VerifyArgs: verifyArgs,
    })
  );
  return instructions;
}
