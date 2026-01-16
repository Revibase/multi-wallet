import {
  decompressSettingsAccount,
  fetchMaybeSettings,
  getSettingsFromIndex,
  getSolanaRpc,
} from "@revibase/core";
import { expect } from "chai";
import {
  assertTestContext,
  createMultiWallet,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runDecompressionTests(getCtx: () => TestContext) {
  it("should successfully decompress settings account and verify it exists", async () => {
    await withErrorHandling("decompress settings account", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "payer", "wallet"]);

      const decompressIxs = await decompressSettingsAccount({
        index: ctx.index,
        payer: ctx.payer,
        signers: [ctx.wallet],
      });

      await sendTransaction(
        [...decompressIxs],
        ctx.payer,
        ctx.addressLookUpTable
      );

      const settings = await getSettingsFromIndex(ctx.index);
      const settingsData = await fetchMaybeSettings(getSolanaRpc(), settings);

      expect(settingsData.exists, "Settings account should exist after decompression").to.be
        .true;
    });
  });
}
