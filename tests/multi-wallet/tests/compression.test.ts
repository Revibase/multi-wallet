import {
  compressSettingsAccount,
  decompressSettingsAccount,
  fetchMaybeSettings,
  fetchSettingsData,
  getSettingsFromIndex,
  getSolanaRpc,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runCompressionTests() {
  describe("Compress Settings Account", () => {
    let ctx: TestContext;
    let ctx1: TestContext;

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment(false);
      ctx = await createMultiWallet(ctx);
      ctx1 = await setupTestEnvironment(false);
      ctx1 = await createMultiWallet(ctx1);
    });

    it("should handle compress settings account", async () => {
      if (!ctx.index) return;
      const compressIxs = await compressSettingsAccount({
        index: ctx.index,
        payer: ctx.payer,
        signers: [ctx.wallet],
      });

      try {
        await sendTransaction(
          [...compressIxs],
          ctx.payer,
          ctx.addressLookUpTable
        );
        const settings = await getSettingsFromIndex(ctx.index);
        const settingsData = await fetchMaybeSettings(getSolanaRpc(), settings);
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

    it("should handle compress settings account then decompress settings account", async () => {
      if (!ctx1.index) return;
      const compressIxs = await compressSettingsAccount({
        index: ctx1.index,
        payer: ctx1.payer,
        signers: [ctx1.wallet],
      });

      try {
        await sendTransaction(
          [...compressIxs],
          ctx1.payer,
          ctx1.addressLookUpTable
        );
        const settings = await getSettingsFromIndex(ctx1.index);
        const settingsData = await fetchMaybeSettings(getSolanaRpc(), settings);
        expect(settingsData.exists).equal(
          false,
          "Settings account should be null"
        );
        const settingsDataCompressed = await fetchSettingsData(ctx1.index);
        expect(Number(settingsDataCompressed.index)).equal(
          Number(ctx1.index),
          "Settings compressed account should not be null"
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }

      const decompressIxs = await decompressSettingsAccount({
        index: ctx1.index,
        payer: ctx1.payer,
        signers: [ctx1.wallet],
      });

      try {
        await sendTransaction(
          [...decompressIxs],
          ctx1.payer,
          ctx1.addressLookUpTable
        );
        const settings = await getSettingsFromIndex(ctx1.index);
        const settingsData = await fetchMaybeSettings(getSolanaRpc(), settings);
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
