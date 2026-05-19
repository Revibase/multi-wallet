import type { Address, TransactionSigner } from "gill";
import { getTransactionBufferExecuteInstruction } from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export function executeTransactionBuffer({
  executor,
  transactionBufferAddress,
  settings,
}: {
  executor?: TransactionSigner | SignedSecp256r1Key;
  transactionBufferAddress: Address;
  settings: Address;
}) {
  const { domainConfig, verifyArgs, signature, message, publicKey } =
    extractSecp256r1VerificationArgs(executor);
  const instructions = [];
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
    getTransactionBufferExecuteInstruction({
      settings,
      transactionBuffer: transactionBufferAddress,
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      executor: executor instanceof SignedSecp256r1Key ? undefined : executor,
      remainingAccounts: [],
    }),
  );

  return instructions;
}
