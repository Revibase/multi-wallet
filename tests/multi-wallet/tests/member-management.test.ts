import {
  changeConfig,
  convertMemberKeyToString,
  DelegateOp,
  fetchDelegateData,
  fetchSettingsData,
  prepareTransactionBundle,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runMemberManagementTests() {
  describe("Member Management", () => {
    let ctx: TestContext;

    // Set up a fresh context for each test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
    });

    it("should add a new member", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "AddMembers",
            members: [
              {
                pubkey: ctx.payer,
                permissions: { initiate: true, vote: true, execute: true },
                setAsDelegate: true,
                isTransactionManager: false,
              },
            ],
          },
        ],
      });

      const transactionMessageBytes = prepareTransactionMessage({
        payer: ctx.multiWalletVault,
        instructions,
        addressesByLookupTableAddress: ctx.addressLookUpTable,
      });
      const { ixs, payer, addressLookupTableAccounts } =
        await prepareTransactionSync({
          compressed: ctx.compressed,
          payer: ctx.payer,
          index: ctx.index,
          signers: [ctx.wallet],
          transactionMessageBytes,
          secp256r1VerifyInput,
        });

      await sendTransaction(ixs, payer, addressLookupTableAccounts);

      // Verify member was added
      const accountData = await fetchSettingsData(ctx.index);
      const delegateData = await fetchDelegateData(ctx.payer.address);
      const settingsIndex =
        delegateData.settingsIndex.__option === "Some"
          ? delegateData.settingsIndex.value
          : null;
      expect(settingsIndex).equal(ctx.index, "Payer should be a delegate");
      expect(accountData.members.length).to.equal(2, "Should have two members");
      expect(convertMemberKeyToString(accountData.members[1].pubkey)).to.equal(
        ctx.payer.address.toString(),
        "Second member should be the payer"
      );
    });

    it("remove delegate permission for new member", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      // Test updating permissions for existing members
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "EditPermissions",
            members: [
              {
                pubkey: ctx.payer.address,
                permissions: { initiate: true, vote: true, execute: true },
                delegateOperation: DelegateOp.Remove,
              },
            ],
          },
        ],
      });

      const transactionMessageBytes = prepareTransactionMessage({
        payer: ctx.multiWalletVault,
        instructions,
        addressesByLookupTableAddress: ctx.addressLookUpTable,
      });
      const result = await prepareTransactionBundle({
        compressed: ctx.compressed,
        payer: ctx.payer,
        index: ctx.index,
        creator: ctx.wallet,
        transactionMessageBytes,
        secp256r1VerifyInput,
      });
      for (const x of result) {
        await sendTransaction(x.ixs, x.payer, x.addressLookupTableAccounts);
      }
      // Verify permissions were updated
      const delegateData = await fetchDelegateData(ctx.payer.address);
      expect(delegateData.settingsIndex.__option).equal(
        "None",
        "Payer should be a delegate"
      );
    });

    it("add back delegate permission for new member", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      // Test updating permissions for existing members
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "EditPermissions",
            members: [
              {
                pubkey: ctx.payer.address,
                permissions: { initiate: true, vote: true, execute: true },
                delegateOperation: DelegateOp.Add,
              },
            ],
          },
        ],
      });

      const transactionMessageBytes = prepareTransactionMessage({
        payer: ctx.multiWalletVault,
        instructions,
        addressesByLookupTableAddress: ctx.addressLookUpTable,
      });
      const result = await prepareTransactionBundle({
        compressed: ctx.compressed,
        payer: ctx.payer,
        index: ctx.index,
        creator: ctx.wallet,
        transactionMessageBytes,
        secp256r1VerifyInput,
      });
      for (const x of result) {
        await sendTransaction(x.ixs, x.payer, x.addressLookupTableAccounts);
      }
      // Verify permissions were updated
      const delegateData = await fetchDelegateData(ctx.payer.address);
      const settingsIndex =
        delegateData.settingsIndex.__option === "Some"
          ? delegateData.settingsIndex.value
          : null;
      expect(settingsIndex).equal(ctx.index, "Payer should be a delegate");
    });

    it("should remove a member", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "RemoveMembers",
            members: [
              {
                pubkey: ctx.payer.address,
              },
            ],
          },
        ],
      });

      const transactionMessageBytes = prepareTransactionMessage({
        payer: ctx.multiWalletVault,
        instructions,
        addressesByLookupTableAddress: ctx.addressLookUpTable,
      });
      const result = await prepareTransactionBundle({
        compressed: ctx.compressed,
        payer: ctx.payer,
        index: ctx.index,
        creator: ctx.wallet,
        transactionMessageBytes,
        secp256r1VerifyInput,
      });
      for (const x of result) {
        await sendTransaction(x.ixs, x.payer, x.addressLookupTableAccounts);
      }
      // Verify member was removed
      const accountData = await fetchSettingsData(ctx.index);
      const delegateData = await fetchDelegateData(ctx.payer.address);
      const settingsIndex =
        delegateData.settingsIndex.__option === "Some"
          ? delegateData.settingsIndex.value
          : null;
      expect(settingsIndex).equal(null, "Payer should not be a delegate");
      expect(accountData.members.length).to.equal(1, "Should have one member");
      expect(convertMemberKeyToString(accountData.members[0].pubkey)).to.equal(
        ctx.wallet.address.toString(),
        "Remaining member should be the wallet"
      );
      expect(accountData.threshold).to.equal(
        1,
        "Threshold should be updated to 1"
      );
    });
  });
}
