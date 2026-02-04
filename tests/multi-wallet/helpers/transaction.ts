import {
  changeConfig,
  getSendAndConfirmTransaction,
  getSettingsFromIndex,
  getSolanaRpc,
  prepareChangeConfigArgs,
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
import {
  TEST_COMPUTE_UNIT_LIMIT,
  TEST_TRANSACTION_DELAY_MS,
} from "../constants.ts";
import type { TestContext } from "../types.ts";
import { assertTestContext, delay } from "./test-utils.ts";

/**
 * Sends a transaction with the given instructions
 */
export async function sendTransaction(
  instructions: Instruction[],
  payer: TransactionSigner,
  addressLookupTableAccounts?: AddressesByLookupTableAddress,
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
            units: TEST_COMPUTE_UNIT_LIMIT,
          }),
          tx,
        );
      },
      (tx) =>
        addressLookupTableAccounts
          ? compressTransactionMessageUsingAddressLookupTables(
              tx,
              addressLookupTableAccounts,
            )
          : tx,
      async (tx) => await signTransactionMessageWithSigners(tx),
    );

    console.log(getBase64EncodedWireTransaction(tx).length);
    signature = getSignatureFromTransaction(tx);
    await getSendAndConfirmTransaction()(tx, {
      commitment: "confirmed",
      skipPreflight: true,
    });
    await delay(TEST_TRANSACTION_DELAY_MS);
    return signature;
  } catch (error) {
    console.log(signature);
    if (isSolanaError(error) && error.cause) {
      const formattedError = JSON.stringify(error.cause, (key, value) =>
        typeof value === "bigint" ? value.toString() : value,
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
  amount: bigint,
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
  assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

  const changeConfigArgs = await prepareChangeConfigArgs({
    compressed: ctx.compressed,
    settings: await getSettingsFromIndex(ctx.index),
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

  const instructions = await changeConfig({
    signers: [ctx.wallet],
    payer: ctx.payer,
    changeConfigArgs,
  });

  await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);
}
