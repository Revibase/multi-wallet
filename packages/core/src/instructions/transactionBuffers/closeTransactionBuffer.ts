import type { Address, TransactionSigner } from "gill";
import {
  fetchTransactionBuffer,
  getTransactionBufferCloseInstruction,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { getSolanaRpc } from "../../utils";
import { extractSecp256r1VerificationArgs } from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function closeTransactionBuffer({
  closer,
  transactionBufferAddress,
}: {
  closer: TransactionSigner | SignedSecp256r1Key;
  transactionBufferAddress: Address;
}) {
  const transactionBuffer = await fetchTransactionBuffer(
    getSolanaRpc(),
    transactionBufferAddress,
  );
  const settings = transactionBuffer.data.multiWalletSettings;
  const { domainConfig, verifyArgs, message, signature, publicKey } =
    extractSecp256r1VerificationArgs(closer);

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
    getTransactionBufferCloseInstruction({
      transactionBuffer: transactionBufferAddress,
      domainConfig,
      closer: closer instanceof SignedSecp256r1Key ? undefined : closer,
      settings,
      payer: transactionBuffer.data.payer,
      secp256r1VerifyArgs: verifyArgs,
      remainingAccounts: [],
    }),
  );

  return instructions;
}
