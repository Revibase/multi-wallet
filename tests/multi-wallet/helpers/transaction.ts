import { getTransferSolInstruction } from "@solana-program/system";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getSignatureFromTransaction,
  type IInstruction,
  isSolanaError,
  lamports,
  pipe,
  type Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import type { TestContext } from "../types";

/**
 * Sends a transaction with the given instructions
 */
export async function sendTransaction(
  connection: Rpc<SolanaRpcApi>,
  instructions: IInstruction[],
  payer: TransactionSigner,
  sendAndConfirm: any
): Promise<string | undefined> {
  // Get latest blockhash before starting transaction
  const latestBlockHash = await connection.getLatestBlockhash().send();

  try {
    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions(instructions, tx),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(latestBlockHash.value, tx),
      async (tx) => await signTransactionMessageWithSigners(tx)
    );

    const signature = getSignatureFromTransaction(tx);
    console.log(signature);
    await sendAndConfirm(tx, { commitment: "confirmed", skipPreflight: true });
    return signature;
  } catch (error) {
    if (isSolanaError(error) && error.cause) {
      const formattedError = JSON.stringify(error.cause, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      );

      try {
        // Try to parse and extract a more user-friendly message
        const parsedError = JSON.parse(formattedError);
        console.log(parsedError);
        const errorMessage =
          parsedError.message ||
          parsedError.error?.message ||
          "Transaction failed. Please try again.";

        throw new Error(errorMessage);
      } catch {
        // If parsing fails, use the original error
        throw new Error(`Transaction failed: ${formattedError}`);
      }
    } else {
      throw error;
    }
  }
}

/**
 * Funds a multi-wallet vault with the specified amount
 */
export async function fundMultiWalletVault(
  ctx: TestContext,
  amount: bigint
): Promise<void> {
  const transfer = getTransferSolInstruction({
    source: ctx.payer,
    destination: address(ctx.multiWalletVault.toString()),
    amount: lamports(amount),
  });

  await sendTransaction(
    ctx.connection,
    [transfer],
    ctx.payer,
    ctx.sendAndConfirm
  );
}
