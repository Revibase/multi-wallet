import {
  decompressSettingsAccount,
  fetchMaybeSettings,
  getSettingsFromIndex,
  getSolanaRpc,
} from "@revibase/core";
import { expect } from "chai";
import { createMultiWallet, sendTransaction } from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runDecompressionTests(getCtx: () => TestContext) {
  it("should handle decompress settings account", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.index) return;
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
  });
}
