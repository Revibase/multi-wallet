import { Address, IInstruction, TransactionSigner } from "@solana/kit";
import { getTransactionBufferExecuteInstruction } from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function executeTransactionBuffer({
  settings,
  executor,
  transactionBufferAddress,
}: {
  settings: Address;
  executor?: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: Address;
}) {
  let slotHashSysvar = undefined;
  let domainConfig = undefined;
  let verifyArgs = null;
  let message = undefined;
  let signature = undefined;
  let publicKey = undefined;
  let instructionsSysvar = undefined;
  const instructions: IInstruction[] = [];

  if (executor) {
    ({
      slotHashSysvar,
      domainConfig,
      verifyArgs,
      signature,
      message,
      publicKey,
      instructionsSysvar,
    } = await extractSecp256r1VerificationArgs(executor));
  }
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
  const signer = executor instanceof Secp256r1Key ? undefined : executor;
  instructions.push(
    getTransactionBufferExecuteInstruction({
      instructionsSysvar,
      slotHashSysvar,
      settings,
      transactionBuffer: transactionBufferAddress,
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      executor: signer,
    })
  );
  return instructions;
}
