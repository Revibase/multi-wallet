import { fetchSettingsAccountData, getSolanaRpc } from "@revibase/core";
import { expect } from "chai";
import { address } from "gill";
import { TEST_AMOUNT_SMALL, WALLET_TRANSFER_AMOUNT } from "../constants.ts";
import {
  assertTestContext,
  createMultiWallet,
  fundMultiWalletVault,
  withErrorHandling,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runWalletCreationTests(getCtx: () => TestContext) {
  it("should create a multi-wallet with correct initial state", async () => {
    await withErrorHandling("create multi-wallet", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault"]);

      // Verify wallet settings
      const accountData = await fetchSettingsAccountData(ctx.index);

      expect(
        accountData.members.length,
        "Wallet should have exactly one member initially"
      ).to.equal(1);
      expect(
        accountData.threshold,
        "Wallet should be configured as a single-signature wallet"
      ).to.equal(1);

      // Fund the wallet
      await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_SMALL * 10));

      // Verify wallet balance
      const vaultBalance = await getSolanaRpc()
        .getBalance(address(ctx.multiWalletVault))
        .send();

      expect(
        vaultBalance.value,
        "Wallet should have the expected balance after funding"
      ).to.equal(WALLET_TRANSFER_AMOUNT);
    });
  });
}
