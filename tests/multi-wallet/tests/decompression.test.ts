import {
  compressSettingsAccount,
  decompressSettingsAccount,
  fetchMaybeSettings,
  fetchSettingsData,
  getSettingsFromIndex,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers";
import type { TestContext } from "../types";

export function runDecompressionTests() {
  describe("Decompress Settings Account", () => {
    let ctx: TestContext;
    let ctx1: TestContext;
    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment(true);
      ctx = await createMultiWallet(ctx);
      ctx1 = await setupTestEnvironment(true);
      ctx1 = await createMultiWallet(ctx1);
    });

    it("should handle decompress settings account", async () => {
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

    it("should handle decompress settings account then compress settings account", async () => {
      const decompressIxs = await decompressSettingsAccount({
        index: ctx1.index,
        payer: ctx1.payer,
        signers: [ctx1.wallet],
      });

      try {
        await sendTransaction(
          ctx1.connection,
          [...decompressIxs],
          ctx1.payer,
          ctx1.sendAndConfirm,
          ctx1.addressLookUpTable
        );
        const settings = await getSettingsFromIndex(ctx1.index);
        const settingsData = await fetchMaybeSettings(
          ctx1.connection,
          settings
        );

        expect(settingsData.exists).equal(
          true,
          "Settings account should exist"
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }

      const compressIxs = await compressSettingsAccount({
        index: ctx1.index,
        payer: ctx1.payer,
        signers: [ctx1.wallet],
      });

      try {
        await sendTransaction(
          ctx1.connection,
          [...compressIxs],
          ctx1.payer,
          ctx1.sendAndConfirm,
          ctx1.addressLookUpTable
        );
        const settings = await getSettingsFromIndex(ctx1.index);
        const settingsData = await fetchMaybeSettings(
          ctx1.connection,
          settings
        );
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
    });
  });
}
