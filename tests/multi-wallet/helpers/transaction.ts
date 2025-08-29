import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  address,
  AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Instruction,
  isSolanaError,
  lamports,
  pipe,
  prependTransactionMessageInstruction,
  type Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import type { TestContext } from "../types";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a transaction with the given instructions
 */
export async function sendTransaction(
  connection: Rpc<SolanaRpcApi>,
  instructions: Instruction[],
  payer: TransactionSigner,
  sendAndConfirm: any,
  addressLookupTableAccounts?: AddressesByLookupTableAddress
): Promise<string | undefined> {
  // Get latest blockhash before starting transaction
  const latestBlockHash = await connection.getLatestBlockhash().send();

  let signature;
  let tx;
  try {
    tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions(instructions, tx),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(latestBlockHash.value, tx),
      (tx) => {
        return prependTransactionMessageInstruction(
          getSetComputeUnitLimitInstruction({
            units: 800_000,
          }),
          tx
        );
      },
      (tx) =>
        addressLookupTableAccounts
          ? compressTransactionMessageUsingAddressLookupTables(
              tx,
              addressLookupTableAccounts
            )
          : tx,
      async (tx) => await signTransactionMessageWithSigners(tx)
    );

    console.log(getBase64EncodedWireTransaction(tx).length);
    signature = getSignatureFromTransaction(tx);
    await sendAndConfirm(tx, { commitment: "confirmed", skipPreflight: true });
    await delay(3000);
    return signature;
  } catch (error) {
    console.log(signature);
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
