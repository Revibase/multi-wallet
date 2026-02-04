import {
  fetchSettingsAccountData,
  fetchUserAccountData,
  getSettingsFromIndex,
  getSolanaRpc,
  getWalletAddressFromIndex,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/core";
import { expect } from "chai";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
} from "gill";
import {
  getCreateAccountInstruction,
  getInitializeMintInstruction,
  getMintSize,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "gill/programs";
import { MEDIUM_TRANSFER_AMOUNT, TEST_MINT_DECIMALS } from "../constants.ts";
import {
  assertTestContext,
  createMultiWallet,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import { fundMultiWalletVault } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runTransactionTests(getCtx: () => TestContext) {
  it("should successfully handle ephemeral transactions with mint creation", async () => {
    await withErrorHandling("ephemeral transaction with mint", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "wallet", "payer"]);

      // Fund the wallet for transaction
      await fundMultiWalletVault(ctx, MEDIUM_TRANSFER_AMOUNT);

      // Create ephemeral keypair
      const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32)),
      );

      // Create account instruction
      const createAccount = getCreateAccountInstruction({
        payer: createNoopSigner(address(ctx.multiWalletVault)),
        newAccount: ephemeralKeypair,
        space: getMintSize(),
        lamports: await getSolanaRpc()
          .getMinimumBalanceForRentExemption(BigInt(getMintSize()))
          .send(),
        programAddress: TOKEN_2022_PROGRAM_ADDRESS,
      });

      // Create mint instruction
      const createMint = getInitializeMintInstruction({
        mint: ephemeralKeypair.address,
        decimals: TEST_MINT_DECIMALS,
        mintAuthority: ctx.multiWalletVault,
      });

      // Prepare transaction message
      const transactionMessageBytes = prepareTransactionMessage({
        payer: ctx.multiWalletVault,
        instructions: [createAccount, createMint],
        addressesByLookupTableAddress: ctx.addressLookUpTable,
      });

      // Prepare transaction
      const result = await prepareTransactionSync({
        compressed: ctx.compressed,
        payer: ctx.payer,
        transactionMessageBytes,
        signers: [ephemeralKeypair, ctx.wallet],
        settings: await getSettingsFromIndex(ctx.index),
      });

      await sendTransaction(
        [...result.instructions],
        ctx.payer,
        result.addressesByLookupTableAddress,
      );

      // Verify transaction was successful
      const settings = await getSettingsFromIndex(ctx.index);
      const accountData = await fetchSettingsAccountData(settings);
      const userAccountData = await fetchUserAccountData(ctx.wallet.address);
      const settingsIndex =
        userAccountData.wallets.find((x) => x.isDelegate) ?? null;

      expect(
        settingsIndex,
        "User should not be delegated after ephemeral transaction",
      ).to.be.null;

      const walletAddress = await getWalletAddressFromIndex(ctx.index);
      expect(
        walletAddress.toString(),
        "Wallet address should match the vault address",
      ).to.equal(ctx.multiWalletVault.toString());

      expect(
        accountData.members.length,
        "Wallet should have at least one member",
      ).to.be.greaterThan(0);

      expect(
        accountData.threshold,
        "Wallet threshold should be at least 1",
      ).to.be.greaterThan(0);

      // Verify mint account was created
      const mintAccount = await getSolanaRpc()
        .getAccountInfo(ephemeralKeypair.address)
        .send();

      expect(mintAccount.value, "Mint account should exist after creation").to
        .not.be.null;

      expect(
        mintAccount.value?.owner.toString(),
        "Mint account should be owned by token program",
      ).to.equal(TOKEN_2022_PROGRAM_ADDRESS.toString());
    });
  });
}
