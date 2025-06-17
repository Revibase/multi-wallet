import { fetchSettings } from "@revibase/wallet-sdk";
import { address } from "@solana/kit";
import { expect } from "chai";
import { WALLET_TRANSFER_AMOUNT } from "../constants";
import {
  createMultiWallet,
  fundMultiWalletVault,
  setupTestEnvironment,
} from "../helpers";
import type { TestContext } from "../types";

export function runWalletCreationTests() {
  describe("Wallet Creation", () => {
    let ctx: TestContext;

    // Set up a fresh context for each test
    beforeEach(async () => {
      ctx = await setupTestEnvironment();
    });

    it("should create a multi-wallet with correct initial state", async () => {
      // Create the multi-wallet
      ctx = await createMultiWallet(ctx);

      // Verify wallet settings
      const accountData = await fetchSettings(
        ctx.connection,
        address(ctx.settings)
      );

      expect(accountData.data.members.length).to.equal(
        1,
        "Should have only one member initially"
      );
      expect(accountData.data.threshold).to.equal(
        1,
        "Should be a single-sig wallet"
      );

      // Fund the wallet
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.01));

      // Verify wallet balance
      const vaultBalance = await ctx.connection
        .getBalance(address(ctx.multiWalletVault))
        .send();

      expect(vaultBalance.value).to.equal(
        WALLET_TRANSFER_AMOUNT,
        "Wallet should have the correct balance"
      );
    });
  });
}
