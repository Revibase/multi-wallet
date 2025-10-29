import { fetchSettingsAccountData, getSolanaRpc } from "@revibase/wallet";
import { expect } from "chai";
import { address } from "gill";
import { WALLET_TRANSFER_AMOUNT } from "../constants.ts";
import {
  createMultiWallet,
  fundMultiWalletVault,
  setupTestEnvironment,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

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
      if (!ctx.index || !ctx.multiWalletVault) return;
      // Verify wallet settings
      const accountData = await fetchSettingsAccountData(ctx.index);

      expect(accountData.members.length).to.equal(
        1,
        "Should have only one member initially"
      );
      expect(accountData.threshold).to.equal(
        1,
        "Should be a single-sig wallet"
      );

      // Fund the wallet
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.01));

      // Verify wallet balance
      const vaultBalance = await getSolanaRpc()
        .getBalance(address(ctx.multiWalletVault))
        .send();

      expect(vaultBalance.value).to.equal(
        WALLET_TRANSFER_AMOUNT,
        "Wallet should have the correct balance"
      );
    });
  });
}
