import { address, TransactionSigner } from "@solana/kit";
import { getTransactionBufferCloseInstruction } from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";

export function closeTransactionBuffer({
  settings,
  feePayer,
  closer,
  transactionBufferAddress,
}: {
  feePayer: string;
  settings: string;
  closer: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: string;
}) {
  const { slotHashSysvar, domainConfig, verifyArgs } =
    extractSecp256r1VerificationArgs(closer);

  return getTransactionBufferCloseInstruction({
    slotHashSysvar,
    transactionBuffer: address(transactionBufferAddress),
    domainConfig: domainConfig,
    closer: closer instanceof Secp256r1Key ? undefined : closer,
    settings: address(settings),
    payer: address(feePayer),
    secp256r1VerifyArgs: verifyArgs,
  });
}
