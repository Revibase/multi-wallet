import {
  changeConfig,
  getSendAndConfirmTransaction,
  getSolanaRpc,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/core";
import {
  address,
  type AddressesByLookupTableAddress,
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
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getTransferSolInstruction,
} from "gill/programs";
import type { TestContext } from "../types.ts";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a transaction with the given instructions
 */
export async function sendTransaction(
  instructions: Instruction[],
  payer: TransactionSigner,
  addressLookupTableAccounts?: AddressesByLookupTableAddress
): Promise<string | undefined> {
  // Get latest blockhash before starting transaction
  const latestBlockHash = await getSolanaRpc().getLatestBlockhash().send();

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
    await getSendAndConfirmTransaction()(tx, {
      commitment: "confirmed",
      skipPreflight: true,
    });
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
  if (!ctx.multiWalletVault || !ctx.payer) return;
  const transfer = getTransferSolInstruction({
    source: ctx.payer,
    destination: address(ctx.multiWalletVault.toString()),
    amount: lamports(amount),
  });

  await sendTransaction([transfer], ctx.payer);
}

export async function addPayerAsNewMember(ctx: TestContext) {
  if (!ctx.index || !ctx.multiWalletVault || !ctx.payer || !ctx.wallet) return;
  const { instructions, secp256r1VerifyInput } = await changeConfig({
    payer: ctx.payer,
    compressed: ctx.compressed,
    index: ctx.index,
    configActionsArgs: [
      {
        type: "AddMembers",
        members: [
          {
            member: ctx.payer.address,
            permissions: { initiate: true, vote: true, execute: true },
          },
        ],
      },
    ],
  });

  const transactionMessageBytes = prepareTransactionMessage({
    payer: ctx.multiWalletVault,
    instructions,
    addressesByLookupTableAddress: ctx.addressLookUpTable,
  });
  const {
    instructions: ixs,
    payer,
    addressesByLookupTableAddress,
  } = await prepareTransactionSync({
    compressed: ctx.compressed,
    payer: ctx.payer,
    index: ctx.index,
    signers: [ctx.wallet],
    transactionMessageBytes,
    secp256r1VerifyInput,
  });

  await sendTransaction(ixs, payer, addressesByLookupTableAddress);
}
