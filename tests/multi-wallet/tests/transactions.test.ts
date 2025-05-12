import {
  fetchMaybeDelegate,
  fetchSettings,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/wallet-sdk";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMint2Instruction,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
} from "@solana/kit";
import { expect } from "chai";
import {
  createMultiWallet,
  fundMultiWalletVault,
  generateSecp256r1KeyPair,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers";
import type { TestContext } from "../types";

export function runTransactionTests() {
  describe("Transaction Handling", () => {
    let ctx: TestContext;
    let secp256r1Keys: { privateKey: Uint8Array; publicKey: Uint8Array };

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
      secp256r1Keys = generateSecp256r1KeyPair();
    });

    it("should handle ephemeral transactions", async () => {
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
        lamports: await ctx.connection
          .getMinimumBalanceForRentExemption(BigInt(getMintSize()))
          .send(),
        programAddress: TOKEN_PROGRAM_ADDRESS,
      });

      // Create mint instruction
      const createMint = getInitializeMint2Instruction({
        mint: ephemeralKeypair.address,
        decimals: 5,
        mintAuthority: address(ctx.multiWalletVault),
      });

      // Get recent blockhash
      const recentBlockHash = await ctx.connection.getLatestBlockhash().send();

      // Prepare transaction message
      const transactionMessageBytes = await prepareTransactionMessage(
        recentBlockHash.value.blockhash,
        ctx.payer.address,
        [createAccount, createMint]
      );

      try {
        // Prepare transaction
        const result = await prepareTransactionSync({
          rpc: ctx.connection,
          feePayer: ctx.payer,
          transactionMessageBytes,
          signers: [ephemeralKeypair, ctx.wallet],
          settings: ctx.settings,
        });

        await sendTransaction(
          ctx.connection,
          [...result.ixs],
          ctx.payer,
          ctx.sendAndConfirm
        );

        // Verify transaction was successful
        const accountData = await fetchSettings(
          ctx.connection,
          address(ctx.settings)
        );
        const delegateData = await fetchMaybeDelegate(
          ctx.connection,
          ctx.wallet.address
        );

        expect(delegateData.multiWalletSettings.toString()).to.equal(
          ctx.settings.toString(),
          "Delegate should be associated with the correct settings"
        );
        expect(delegateData.multiWallet.toString()).to.equal(
          ctx.multiWalletVault.toString(),
          "Delegate should be associated with the correct vault"
        );
        expect(accountData.data.members.length).to.be.greaterThan(
          0,
          "Should have at least one member"
        );
        expect(accountData.data.threshold).to.be.greaterThan(
          0,
          "Threshold should be at least 1"
        );

        // Verify mint account was created
        const mintAccount = await ctx.connection
          .getAccountInfo(ephemeralKeypair.address)
          .send();

        expect(mintAccount.value).to.not.be.null;
        expect(mintAccount.value?.owner.toString()).to.equal(
          TOKEN_PROGRAM_ADDRESS.toString(),
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
