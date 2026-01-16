import {
  changeConfig,
  fetchSettingsAccountData,
  prepareChangeConfigArgs,
} from "@revibase/core";
import { expect } from "chai";
import {
  assertTestContext,
  createMultiWallet,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runThresholdManagementTests(getCtx: () => TestContext) {
  it("should successfully update threshold to match number of members", async () => {
    await withErrorHandling("update threshold", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      await addPayerAsNewMember(ctx);

      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "SetThreshold",
            threshold: 2,
          },
        ],
      });

      const instructions = await changeConfig({
        signers: [ctx.wallet],
        payer: ctx.payer,
        changeConfigArgs,
      });

      await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);

      const accountData = await fetchSettingsAccountData(ctx.index);
      expect(
        accountData.threshold,
        "Threshold should be updated to 2"
      ).to.equal(2);
      expect(
        accountData.members.length,
        "Should still have 2 members"
      ).to.equal(2);
    });
  });

  it("should fail when trying to remove member that would make threshold invalid", async () => {
    await withErrorHandling(
      "remove member with threshold too high should fail",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "payer",
          "wallet",
        ]);

        await addPayerAsNewMember(ctx);

        // Set threshold to 2
        const setThresholdArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          index: ctx.index,
          configActionsArgs: [
            {
              type: "SetThreshold",
              threshold: 2,
            },
          ],
        });

        await sendTransaction(
          await changeConfig({
            signers: [ctx.wallet],
            payer: ctx.payer,
            changeConfigArgs: setThresholdArgs,
          }),
          ctx.payer,
          ctx.addressLookUpTable
        );

        // Try to remove payer member - this should fail because threshold is 2
        // and removing a member would leave only 1 member
        const removeMemberArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          index: ctx.index,
          configActionsArgs: [
            {
              type: "RemoveMembers",
              members: [{ member: ctx.payer.address }],
            },
          ],
        });

        let transactionFailed = false;
        try {
          await sendTransaction(
            await changeConfig({
              signers: [ctx.wallet],
              payer: ctx.payer,
              changeConfigArgs: removeMemberArgs,
            }),
            ctx.payer,
            ctx.addressLookUpTable
          );
        } catch (error) {
          transactionFailed = true;
        }

        expect(
          transactionFailed,
          "Removing member when threshold would become invalid should fail"
        ).to.be.true;

        // Verify threshold and member count remain unchanged
        const accountData = await fetchSettingsAccountData(ctx.index);
        expect(
          accountData.threshold,
          "Threshold should remain 2 after failed removal"
        ).to.equal(2);
        expect(
          accountData.members.length,
          "Should still have 2 members after failed removal"
        ).to.equal(2);
      }
    );
  });

  it("should successfully remove member after reducing threshold first", async () => {
    await withErrorHandling(
      "remove member after threshold reduction",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "payer",
          "wallet",
        ]);

        await addPayerAsNewMember(ctx);

        // Set threshold to 2
        const setThresholdArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          index: ctx.index,
          configActionsArgs: [
            {
              type: "SetThreshold",
              threshold: 2,
            },
          ],
        });

        await sendTransaction(
          await changeConfig({
            signers: [ctx.wallet],
            payer: ctx.payer,
            changeConfigArgs: setThresholdArgs,
          }),
          ctx.payer,
          ctx.addressLookUpTable
        );

        // First reduce threshold to 1
        const reduceThresholdArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          index: ctx.index,
          configActionsArgs: [
            {
              type: "SetThreshold",
              threshold: 1,
            },
          ],
        });

        await sendTransaction(
          await changeConfig({
            signers: [ctx.wallet, ctx.payer],
            payer: ctx.payer,
            changeConfigArgs: reduceThresholdArgs,
          }),
          ctx.payer,
          ctx.addressLookUpTable
        );

        // Now remove payer member - this should succeed
        const removeMemberArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          index: ctx.index,
          configActionsArgs: [
            {
              type: "RemoveMembers",
              members: [{ member: ctx.payer.address }],
            },
          ],
        });

        await sendTransaction(
          await changeConfig({
            signers: [ctx.wallet],
            payer: ctx.payer,
            changeConfigArgs: removeMemberArgs,
          }),
          ctx.payer,
          ctx.addressLookUpTable
        );

        const accountData = await fetchSettingsAccountData(ctx.index);
        expect(
          accountData.threshold,
          "Threshold should remain 1 after member removal"
        ).to.equal(1);
        expect(
          accountData.members.length,
          "Should have 1 member after removal"
        ).to.equal(1);
      }
    );
  });
}
