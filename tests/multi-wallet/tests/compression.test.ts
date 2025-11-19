import {
  compressSettingsAccount,
  decompressSettingsAccount,
  fetchMaybeSettings,
  fetchSettingsAccountData,
  getSettingsFromIndex,
  getSolanaRpc,
} from "@revibase/core";
import { expect } from "chai";
import { createMultiWallet, sendTransaction } from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runCompressionTests(getCtx: () => TestContext) {
  it("should handle compress settings account", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.index || !ctx.payer || !ctx.wallet) return;
    const decompressIxs = await decompressSettingsAccount({
      index: ctx.index,
      payer: ctx.payer,
      signers: [ctx.wallet],
    });
    try {
      await sendTransaction(
        [...decompressIxs],
        ctx.payer,
        ctx.addressLookUpTable
      );
      const settings = await getSettingsFromIndex(ctx.index);
      const settingsData = await fetchMaybeSettings(getSolanaRpc(), settings);

      expect(settingsData.exists).equal(true, "Settings account should exist");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }

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
      const settingsDataCompressed = await fetchSettingsAccountData(ctx.index);
      expect(Number(settingsDataCompressed.index)).equal(
        Number(ctx.index),
        "Settings compressed account should not be null"
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
}
