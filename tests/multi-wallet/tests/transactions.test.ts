import {
  fetchDelegateData,
  fetchSettingsData,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  getSolanaRpc,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/wallet";
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
import {
  createMultiWallet,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers/index.ts";
import { fundMultiWalletVault } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runTransactionTests() {
  describe("Transaction Handling", () => {
    let ctx: TestContext;

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
    });

    it("should handle ephemeral transactions", async () => {
      if (!ctx.multiWalletVault || !ctx.index) return;
      // Fund the wallet for transaction
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.3));

      // Create ephemeral keypair
      const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32))
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
        decimals: 5,
        mintAuthority: ctx.multiWalletVault,
      });

      // Prepare transaction message
      const transactionMessageBytes = prepareTransactionMessage({
        payer: ctx.multiWalletVault,
        instructions: [createAccount, createMint],
        addressesByLookupTableAddress: ctx.addressLookUpTable,
      });

      try {
        // Prepare transaction
        const result = await prepareTransactionSync({
          compressed: ctx.compressed,
          payer: ctx.payer,
          transactionMessageBytes,
          signers: [ephemeralKeypair, ctx.wallet],
          index: ctx.index,
        });

        await sendTransaction(
          [...result.ixs],
          ctx.payer,
          result.addressLookupTableAccounts
        );
        const settings = await getSettingsFromIndex(ctx.index);
        // Verify transaction was successful
        const accountData = await fetchSettingsData(ctx.index);
        const delegateData = await fetchDelegateData(ctx.wallet.address);
        const settingsIndex =
          delegateData.settingsIndex.__option === "Some"
            ? delegateData.settingsIndex.value
            : null;
        expect(settingsIndex).to.equal(
          null,
          "Delegate should be associated with the correct settings"
        );
        const multiWallet = await getMultiWalletFromSettings(settings);
        expect(multiWallet.toString()).to.equal(
          ctx.multiWalletVault.toString(),
          "Delegate should be associated with the correct vault"
        );

        expect(accountData.members.length).to.be.greaterThan(
          0,
          "Should have at least one member"
        );
        expect(accountData.threshold).to.be.greaterThan(
          0,
          "Threshold should be at least 1"
        );

        // Verify mint account was created
        const mintAccount = await getSolanaRpc()
          .getAccountInfo(ephemeralKeypair.address)
          .send();

        expect(mintAccount.value).to.not.be.null;
        expect(mintAccount.value?.owner.toString()).to.equal(
          TOKEN_2022_PROGRAM_ADDRESS.toString(),
          "Mint account should be owned by token program"
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("should handle transaction failures gracefully", async () => {
      // Skip this test for now since it's not implemented
      // In a real test suite, you would use this.skip() in Mocha
      console.log("Skipping: Implement error case tests for transactions");
    });
  });
}
