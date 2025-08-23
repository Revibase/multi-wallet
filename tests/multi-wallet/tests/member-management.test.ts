import {
  changeConfig,
  convertMemberKeyToString,
  fetchMaybeUserData,
  fetchSettingsData,
  fetchUserData,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Permission,
  Permissions,
  prepareTransactionBundle,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers";
import type { TestContext } from "../types";

export function runMemberManagementTests() {
  describe("Member Management", () => {
    let ctx: TestContext;

    // Set up a fresh context for each test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
    });

    it("should add a new member", async () => {
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActions: [
          {
            type: "AddMembers",
            members: [
              {
                pubkey: ctx.payer.address,
                permissions: Permissions.fromPermissions([
                  Permission.InitiateTransaction,
                  Permission.ExecuteTransaction,
                  Permission.VoteTransaction,
                  Permission.IsDelegate,
                ]),
              },
            ],
          },
        ],
      });

      const transactionMessageBytes = await prepareTransactionMessage(
        MULTI_WALLET_PROGRAM_ADDRESS.toString(),
        ctx.multiWalletVault,
        instructions,
        ctx.addressLookUpTable
      );
      const { ixs, payer, addressLookupTableAccounts } =
        await prepareTransactionSync({
          compressed: ctx.compressed,
          payer: ctx.payer,
          index: ctx.index,
          signers: [ctx.wallet],
          transactionMessageBytes,
          secp256r1VerifyInput,
        });

      await sendTransaction(
        ctx.connection,
        ixs,
        payer,
        ctx.sendAndConfirm,
        addressLookupTableAccounts
      );

      // Verify member was added
      const accountData = await fetchSettingsData(ctx.index);
      const userData = await fetchUserData(ctx.payer.address);
      const settingsIndex =
        userData.settingsIndex.__option === "Some"
          ? userData.settingsIndex.value
          : null;
      expect(settingsIndex).equal(ctx.index, "Payer should be a delegate");
      expect(accountData.members.length).to.equal(2, "Should have two members");
      expect(convertMemberKeyToString(accountData.members[1].pubkey)).to.equal(
        ctx.payer.address.toString(),
        "Second member should be the payer"
      );
    });

    it("remove delegate permission for new member", async () => {
      // Test updating permissions for existing members
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActions: [
          {
            type: "EditPermissions",
            members: [
              {
                pubkey: ctx.payer.address,
                permissions: Permissions.fromPermissions([
                  Permission.InitiateTransaction,
                  Permission.ExecuteTransaction,
                  Permission.VoteTransaction,
                ]),
              },
            ],
          },
        ],
      });

      const transactionMessageBytes = await prepareTransactionMessage(
        MULTI_WALLET_PROGRAM_ADDRESS,
        ctx.multiWalletVault,
        instructions,
        ctx.addressLookUpTable
      );
      const result = await prepareTransactionBundle({
        compressed: ctx.compressed,
        payer: ctx.payer,
        index: ctx.index,
        creator: ctx.wallet,
        transactionMessageBytes,
        secp256r1VerifyInput,
      });
      for (const x of result) {
        await sendTransaction(
          ctx.connection,
          x.ixs,
          x.payer,
          ctx.sendAndConfirm,
          x.addressLookupTableAccounts
        );
      }
      // Verify permissions were updated
      const accountData = await fetchSettingsData(ctx.index);
      const memberPermissions = accountData.members[1].permissions;

      expect(Permissions.has(memberPermissions, Permission.InitiateTransaction))
        .to.be.true;
      expect(Permissions.has(memberPermissions, Permission.ExecuteTransaction))
        .to.be.true;
      expect(Permissions.has(memberPermissions, Permission.VoteTransaction)).to
        .be.true;
    });

    it("add back delegate permission for new member", async () => {
      // Test updating permissions for existing members
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActions: [
          {
            type: "EditPermissions",
            members: [
              {
                pubkey: ctx.payer.address,
                permissions: Permissions.fromPermissions([
                  Permission.InitiateTransaction,
                  Permission.ExecuteTransaction,
                  Permission.VoteTransaction,
                  Permission.IsDelegate,
                ]),
              },
            ],
          },
        ],
      });

      const transactionMessageBytes = await prepareTransactionMessage(
        MULTI_WALLET_PROGRAM_ADDRESS,
        ctx.multiWalletVault,
        instructions,
        ctx.addressLookUpTable
      );
      const result = await prepareTransactionBundle({
        compressed: ctx.compressed,
        payer: ctx.payer,
        index: ctx.index,
        creator: ctx.wallet,
        transactionMessageBytes,
        secp256r1VerifyInput,
      });
      for (const x of result) {
        await sendTransaction(
          ctx.connection,
          x.ixs,
          x.payer,
          ctx.sendAndConfirm,
          x.addressLookupTableAccounts
        );
      }
      // Verify permissions were updated
      const accountData = await fetchSettingsData(ctx.index);
      const memberPermissions = accountData.members[1].permissions;
      expect(Permissions.has(memberPermissions, Permission.IsDelegate)).to.be
        .true;
      expect(Permissions.has(memberPermissions, Permission.InitiateTransaction))
        .to.be.true;
      expect(Permissions.has(memberPermissions, Permission.ExecuteTransaction))
        .to.be.true;
      expect(Permissions.has(memberPermissions, Permission.VoteTransaction)).to
        .be.true;
    });

    it("should remove a member", async () => {
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActions: [
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

      const transactionMessageBytes = await prepareTransactionMessage(
        MULTI_WALLET_PROGRAM_ADDRESS,
        ctx.multiWalletVault,
        instructions,
        ctx.addressLookUpTable
      );
      const result = await prepareTransactionBundle({
        compressed: ctx.compressed,
        payer: ctx.payer,
        index: ctx.index,
        creator: ctx.wallet,
        transactionMessageBytes,
        secp256r1VerifyInput,
      });
      for (const x of result) {
        await sendTransaction(
          ctx.connection,
          x.ixs,
          x.payer,
          ctx.sendAndConfirm,
          x.addressLookupTableAccounts
        );
      }
      // Verify member was removed
      const accountData = await fetchSettingsData(ctx.index);
      const userData = await fetchMaybeUserData(ctx.payer.address);
      const settingsIndex =
        userData.settingsIndex.__option === "Some"
          ? userData.settingsIndex.value
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
