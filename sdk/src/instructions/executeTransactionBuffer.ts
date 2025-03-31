import { Connection, MessageV0, PublicKey } from "@solana/web3.js";
import { fetchSecp256r1VerifyArgs } from "../functions";
import { Secp256r1Key, TransactionMessage } from "../types";
import {
  accountsForTransactionExecute,
  getMultiWalletFromSettings,
  isPublicKey,
  program,
} from "../utils";

export async function executeTransactionBuffer({
  connection,
  settings,
  executor,
  transactionBufferAddress,
  compiledMessage,
  transactionMessage,
  transactionMessageBytes,
  feePayer,
}: {
  connection: Connection;
  settings: PublicKey;
  feePayer: PublicKey;
  executor: PublicKey | Secp256r1Key;
  transactionBufferAddress: PublicKey;
  compiledMessage: MessageV0;
  transactionMessage: TransactionMessage;
  transactionMessageBytes: Buffer;
}) {
  const multiWallet = getMultiWalletFromSettings(settings);

  const { accountMetas, lookupTableAccounts } =
    await accountsForTransactionExecute({
      connection,
      message: compiledMessage,
      transactionMessage,
      vaultPda: multiWallet,
    });

  const { verifyArgs, domainConfig } = await fetchSecp256r1VerifyArgs(
    "execute",
    executor,
    connection,
    transactionBufferAddress,
    transactionMessageBytes
  );
  const transactionBufferExecuteIx = await program.methods
    .transactionBufferExecute(verifyArgs)
    .accountsPartial({
      rentPayer: feePayer,
      settings,
      transactionBuffer: transactionBufferAddress,
      domainConfig,
      executor: isPublicKey(executor) ? new PublicKey(executor) : null,
    })
    .remainingAccounts(accountMetas)
    .instruction();

  return {
    transactionBufferExecuteIx,
    lookupTableAccounts,
  };
}
