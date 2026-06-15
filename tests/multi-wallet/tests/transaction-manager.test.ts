import {
  changeConfig,
  convertMemberKeyToString,
  createUserAccounts,
  fetchSettings,
  fetchUser,
  getSettingsFromIndex,
  getSolanaRpc,
  getUserAddress,
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
        createUserArgs: {
          member: ephemeralKeypair,
          role: UserRole.TransactionManager,
          transactionManagerUrl: TEST_TRANSACTION_MANAGER_URL,
        },
      });

      await sendTransaction(
        [createUserAccountIx],
        ctx.payer,
        
      );

      const changeConfigArgs = await prepareChangeConfigArgs({
        settings: await getSettingsFromIndex(ctx.index),
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

      const instructions = changeConfig({
        signers: [ctx.wallet],
        payer: ctx.payer,
        changeConfigArgs,
      });

      await sendTransaction(instructions, ctx.payer);

      // Verify member was added
      const userAccountData = (
        await fetchUser(
          getSolanaRpc(),
          await getUserAddress(ephemeralKeypair.address),
        )
      ).data;
      const settings = await getSettingsFromIndex(ctx.index);
      const accountData = (await fetchSettings(getSolanaRpc(), settings)).data;
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
