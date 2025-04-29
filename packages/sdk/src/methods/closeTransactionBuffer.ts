import { Address, TransactionSigner } from "@solana/kit";
import { getTransactionBufferCloseInstruction } from "../generated";
import { Secp256r1Key } from "../types";
import { extractSecp256r1VerificationArgs } from "../utils/internal";

export function closeTransactionBuffer({
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
  const { slotHashSysvar, domainConfig, verifyArgs } =
    extractSecp256r1VerificationArgs(closer);

  return getTransactionBufferCloseInstruction({
    slotHashSysvar,
    transactionBuffer: transactionBufferAddress,
    domainConfig: domainConfig,
    closer: closer instanceof Secp256r1Key ? undefined : closer,
    settings,
    payer: feePayer,
    secp256r1VerifyArgs: verifyArgs,
  });
}
