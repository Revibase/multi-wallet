import {
  compressSettingsAccount,
  fetchMaybeSettings,
  fetchSettingsData,
  getSettingsFromIndex,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  fundMultiWalletVault,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers";
import type { TestContext } from "../types";

export function runCompressionTests() {
  describe("Compress Settings Account", () => {
    let ctx: TestContext;

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment(false);
      ctx = await createMultiWallet(ctx);
    });

    it("should handle compress settings account", async () => {
      // Fund the wallet for transaction
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.3));

      const compressIxs = await compressSettingsAccount({
        index: ctx.index,
        payer: ctx.payer,
        signers: [ctx.wallet],
      });

      try {
        await sendTransaction(
          ctx.connection,
          [...compressIxs],
          ctx.payer,
          ctx.sendAndConfirm,
          ctx.addressLookUpTable
        );
        const settings = await getSettingsFromIndex(ctx.index);
        const settingsData = await fetchMaybeSettings(ctx.connection, settings);
        expect(settingsData.exists).equal(
          false,
          "Settings account should be null"
        );
        const settingsDataCompressed = await fetchSettingsData(ctx.index);
        expect(Number(settingsDataCompressed.index)).equal(
          Number(ctx.index),
          "Settings compressed account should not be null"
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });
}
