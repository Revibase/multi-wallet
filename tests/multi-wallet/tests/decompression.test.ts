import {
  decompressSettingsAccount,
  fetchMaybeSettings,
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

export function runDecompressionTests() {
  describe("Decompress Settings Account", () => {
    let ctx: TestContext;

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
    });

    it("should handle decompress settings account", async () => {
      // Fund the wallet for transaction
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.3));

      const decompressIxs = await decompressSettingsAccount({
        index: ctx.index,
        payer: ctx.payer,
        signers: [ctx.wallet],
      });

      try {
        await sendTransaction(
          ctx.connection,
          [...decompressIxs],
          ctx.payer,
          ctx.sendAndConfirm,
          ctx.addressLookUpTable
        );
        const settings = await getSettingsFromIndex(ctx.index);
        const settingsData = await fetchMaybeSettings(ctx.connection, settings);
        expect(settingsData.exists).equal(
          true,
          "Settings account should exist"
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });
}
