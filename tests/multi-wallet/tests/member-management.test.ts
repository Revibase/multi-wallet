import {
  changeConfig,
  convertMemberKeyToString,
  fetchMaybeDelegate,
  fetchSettingsData,
  getSettingsFromIndex,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Permission,
  Permissions,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  fundMultiWalletVault,
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

    it("should add a new member and update threshold", async () => {
      // Fund the wallet
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.01));
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        compressed: ctx.compressed,
        index: ctx.index,
        configActions: [
          {
            type: "AddMembers",
            members: [
              {
                pubkey: ctx.payer.address,
                permissions: Permissions.fromPermissions([
                  Permission.VoteTransaction,
                ]),
              },
            ],
          },
          { type: "SetThreshold", threshold: 2 },
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
      const delegateData = await fetchMaybeDelegate(ctx.payer.address);

      expect(delegateData).equal(null, "Payer should not be a delegate");
      expect(accountData.members.length).to.equal(2, "Should have two members");
      expect(convertMemberKeyToString(accountData.members[1].pubkey)).to.equal(
        ctx.payer.address.toString(),
        "Second member should be the payer"
      );
      expect(accountData.threshold).to.equal(
        2,
        "Threshold should be updated to 2"
      );
    });

    it("should handle permission updates correctly", async () => {
      // Fund the wallet
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.01));
      // Test updating permissions for existing members
      const { instructions, secp256r1VerifyInput } = await changeConfig({
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
      const { ixs, payer, addressLookupTableAccounts } =
        await prepareTransactionSync({
          compressed: ctx.compressed,
          payer: ctx.payer,
          index: ctx.index,
          signers: [ctx.wallet, ctx.payer],
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
      const settings = await getSettingsFromIndex(ctx.index);
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

    it("should remove a member and update threshold", async () => {
      // Fund the wallet
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.01));
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        compressed: ctx.compressed,
        index: ctx.index,
        configActions: [
          {
            type: "RemoveMembers",
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
          { type: "SetThreshold", threshold: 1 },
        ],
      });

      const transactionMessageBytes = await prepareTransactionMessage(
        MULTI_WALLET_PROGRAM_ADDRESS,
        ctx.multiWalletVault,
        instructions,
        ctx.addressLookUpTable
      );
      const { ixs, payer, addressLookupTableAccounts } =
        await prepareTransactionSync({
          compressed: ctx.compressed,
          payer: ctx.payer,
          index: ctx.index,
          signers: [ctx.wallet, ctx.payer],
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
      // Verify member was removed
      const accountData = await fetchSettingsData(ctx.index);
      const delegateData = await fetchMaybeDelegate(ctx.payer.address);

      expect(delegateData).equal(null, "Payer should not be a delegate");
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
