import {
  changeConfig,
  getSettingsFromIndex,
  nativeTransferIntent,
  prepareChangeConfigArgs,
} from "@revibase/core";
import { expect } from "chai";
import { TEST_AMOUNT_MEDIUM, TEST_AMOUNT_SMALL } from "../constants.ts";
import {
  assertTestContext,
  createMultiWallet,
  fundMultiWalletVault,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runErrorCasesTests(getCtx: () => TestContext) {
  it("should fail when trying to remove the last member", async () => {
    await withErrorHandling("remove last member should fail", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      // Try to remove the only member (wallet)
      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        settings: await getSettingsFromIndex(ctx.index),
        configActionsArgs: [
          {
            type: "RemoveMembers",
            members: [{ member: ctx.wallet.address }],
          },
        ],
      });

      let transactionFailed = false;
      try {
        const instructions = await changeConfig({
          signers: [ctx.wallet],
          payer: ctx.payer,
          changeConfigArgs,
        });

        await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);
      } catch (error) {
        transactionFailed = true;
      }

      expect(transactionFailed, "Removing the last member should fail").to.be
        .true;
    });
  });

  it("should fail when trying to set threshold higher than number of voting members", async () => {
    await withErrorHandling("set threshold too high should fail", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      await addPayerAsNewMember(ctx);

      // Try to set threshold to 3 when we only have 2 members
      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        settings: await getSettingsFromIndex(ctx.index),
        configActionsArgs: [
          {
            type: "SetThreshold",
            threshold: 3,
          },
        ],
      });

      let transactionFailed = false;
      try {
        const instructions = await changeConfig({
          signers: [ctx.wallet],
          payer: ctx.payer,
          changeConfigArgs,
        });

        await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);
      } catch (error) {
        transactionFailed = true;
      }

      expect(
        transactionFailed,
        "Setting threshold higher than voting members should fail",
      ).to.be.true;
    });
  });

  it("should fail when trying to transfer more than wallet balance", async () => {
    await withErrorHandling(
      "transfer more than balance should fail",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "wallet",
          "payer",
        ]);

        // Fund with small amount
        await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_SMALL));
        await addPayerAsNewMember(ctx);

        // Try to transfer more than available
        let transactionFailed = false;
        try {
          const nativeTransfer = await nativeTransferIntent({
            settings: await getSettingsFromIndex(ctx.index),
            payer: ctx.payer,
            signers: [ctx.payer],
            destination: ctx.wallet.address,
            amount: TEST_AMOUNT_MEDIUM, // More than available
            compressed: ctx.compressed,
          });

          await sendTransaction(
            [...nativeTransfer],
            ctx.payer,
            ctx.addressLookUpTable,
          );
        } catch (error) {
          transactionFailed = true;
        }

        expect(
          transactionFailed,
          "Transferring more than wallet balance should fail",
        ).to.be.true;
      },
    );
  });

  it("should fail when trying to add duplicate member", async () => {
    await withErrorHandling("add duplicate member should fail", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      // Try to add wallet as member again (it's already a member)
      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        settings: await getSettingsFromIndex(ctx.index),
        configActionsArgs: [
          {
            type: "AddMembers",
            members: [
              {
                member: ctx.wallet.address,
                permissions: { initiate: true, vote: true, execute: true },
              },
            ],
          },
        ],
      });

      let transactionFailed = false;
      try {
        const instructions = await changeConfig({
          signers: [ctx.wallet],
          payer: ctx.payer,
          changeConfigArgs,
        });

        await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);
      } catch (error) {
        transactionFailed = true;
      }

      expect(transactionFailed, "Adding duplicate member should fail").to.be
        .true;
    });
  });

  it("should fail when trying to remove non-existent member", async () => {
    await withErrorHandling(
      "remove non-existent member should fail",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "payer",
          "wallet",
        ]);

        const changeConfigArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          settings: await getSettingsFromIndex(ctx.index),
          configActionsArgs: [
            {
              type: "RemoveMembers",
              members: [{ member: ctx.payer.address }],
            },
          ],
        });

        let transactionFailed = false;
        try {
          const instructions = await changeConfig({
            signers: [ctx.wallet],
            payer: ctx.payer,
            changeConfigArgs,
          });

          await sendTransaction(
            instructions,
            ctx.payer,
            ctx.addressLookUpTable,
          );
        } catch (error) {
          transactionFailed = true;
        }

        expect(transactionFailed, "Removing non-existent member should fail").to
          .be.true;
      },
    );
  });

  it("should fail when trying to change config without sufficient permissions", async () => {
    await withErrorHandling(
      "change config without permissions should fail",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "payer",
          "wallet",
        ]);

        // Add payer as member with only vote permission (no initiate/execute)
        const addMemberArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          settings: await getSettingsFromIndex(ctx.index),
          configActionsArgs: [
            {
              type: "AddMembers",
              members: [
                {
                  member: ctx.payer.address,
                  permissions: { initiate: false, vote: true, execute: false },
                },
              ],
            },
          ],
        });

        await sendTransaction(
          await changeConfig({
            signers: [ctx.wallet],
            payer: ctx.payer,
            changeConfigArgs: addMemberArgs,
          }),
          ctx.payer,
          ctx.addressLookUpTable,
        );

        // Try to change config using payer (who doesn't have initiate permission)
        const changeConfigArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          settings: await getSettingsFromIndex(ctx.index),
          configActionsArgs: [
            {
              type: "SetThreshold",
              threshold: 2,
            },
          ],
        });

        let transactionFailed = false;
        try {
          const instructions = await changeConfig({
            signers: [ctx.payer], // Payer doesn't have initiate permission
            payer: ctx.payer,
            changeConfigArgs,
          });

          await sendTransaction(
            instructions,
            ctx.payer,
            ctx.addressLookUpTable,
          );
        } catch (error) {
          transactionFailed = true;
        }

        expect(
          transactionFailed,
          "Changing config without initiate permission should fail",
        ).to.be.true;
      },
    );
  });
}
