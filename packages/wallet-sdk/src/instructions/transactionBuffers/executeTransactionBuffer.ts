import { address, TransactionSigner } from "@solana/kit";
import { getTransactionBufferExecuteInstruction } from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";

export function executeTransactionBuffer({
  settings,
  executor,
  transactionBufferAddress,
}: {
  settings: string;
  executor?: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: string;
}) {
  let slotHashSysvar = undefined;
  let domainConfig = undefined;
  let verifyArgs = null;
  if (executor) {
    ({ slotHashSysvar, domainConfig, verifyArgs } =
      extractSecp256r1VerificationArgs(executor));
  }
  const signer = executor instanceof Secp256r1Key ? undefined : executor;
  return getTransactionBufferExecuteInstruction({
    slotHashSysvar,
    settings: address(settings),
    transactionBuffer: address(transactionBufferAddress),
    secp256r1VerifyArgs: verifyArgs,
    domainConfig,
    executor: signer,
  });
}
