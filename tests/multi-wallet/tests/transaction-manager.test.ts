import {
  changeConfig,
  convertMemberKeyToString,
  createUserAccounts,
  fetchSettingsAccountData,
  fetchUserAccountData,
  prepareChangeConfigArgs,
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
import { TEST_TRANSACTION_MANAGER_URL } from "../constants.ts";
import {
  assertDefined,
  assertTestContext,
  createMultiWallet,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runTransactionManagerTests(getCtx: () => TestContext) {
  it("should successfully add a new member as a transaction manager", async () => {
    await withErrorHandling("add transaction manager member", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "wallet", "payer"]);

      const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32)),
      );
      const createUserAccountIx = await createUserAccounts({
        payer: ctx.payer,
        createUserArgs: [
          {
            member: ephemeralKeypair,
            role: UserRole.TransactionManager,
            transactionManagerUrl: TEST_TRANSACTION_MANAGER_URL,
          },
        ],
      });

      await sendTransaction(
        [createUserAccountIx],
        ctx.payer,
        ctx.addressLookUpTable,
      );

      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "AddMembers",
            members: [
              {
                member: ephemeralKeypair.address,
                permissions: { initiate: true, vote: false, execute: false },
              },
            ],
          },
        ],
      });

      const instructions = await changeConfig({
        signers: [ctx.wallet],
        payer: ctx.payer,
        changeConfigArgs,
      });

      await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);

      // Verify member was added
      const userAccountData = await fetchUserAccountData(
        ephemeralKeypair.address,
      );
      const accountData = await fetchSettingsAccountData(ctx.index);
      const settingsIndex =
        userAccountData.wallets.find((x) => x.isDelegate) ?? null;

      assertDefined(
        userAccountData.transactionManagerUrl.__option === "Some"
          ? userAccountData.transactionManagerUrl.value
          : null,
        "Transaction manager URL should be set",
      );
      if (userAccountData.transactionManagerUrl.__option === "Some") {
        expect(
          userAccountData.transactionManagerUrl.value,
          "Transaction manager URL should match the configured value",
        ).to.equal(TEST_TRANSACTION_MANAGER_URL);
      }

      expect(settingsIndex, "Transaction manager should not be a delegate").to
        .be.null;

      expect(
        accountData.members.length,
        "Wallet should have exactly two members after adding transaction manager",
      ).to.equal(2);

      expect(
        convertMemberKeyToString(accountData.members[0].pubkey),
        "First member should be the transaction manager keypair",
      ).to.equal(ephemeralKeypair.address.toString());
    });
  });
}
