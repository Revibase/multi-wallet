import { getSolanaRpc, nativeTransferIntent } from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  fundMultiWalletVault,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runNativeTransferTest() {
  describe("Native Transfer Test", () => {
    let ctx: TestContext;

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment(false);
      ctx = await createMultiWallet(ctx);
    });

    it("should transfer sol", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      await fundMultiWalletVault(ctx, BigInt(10 ** 8));
      try {
        const nativeTransfer = await nativeTransferIntent({
          index: ctx.index,
          payer: ctx.payer,
          signers: [ctx.wallet],
          destination: ctx.wallet.address,
          amount: 10 ** 6,
          compressed: ctx.compressed,
        });

        await sendTransaction(
          [...nativeTransfer],
          ctx.payer,
          ctx.addressLookUpTable
        );

        const data = await getSolanaRpc()
          .getAccountInfo(ctx.multiWalletVault)
          .send();

        expect(Number(data.value?.lamports)).to.equal(
          10 ** 8 - 10 ** 6,
          "Incorrect sol balance"
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });
}
