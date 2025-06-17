import {
  changeConfig,
  convertMemberKeyToString,
  fetchMaybeDelegate,
  fetchSettings,
  getDelegateAddress,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Permission,
  Permissions,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/wallet-sdk";
import { address } from "@solana/kit";
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
        settings: ctx.settings,
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
        instructions
      );
      const { ixs, feePayer } = await prepareTransactionSync({
        rpc: ctx.connection,
        feePayer: ctx.payer,
        settings: ctx.settings,
        signers: [ctx.wallet],
        transactionMessageBytes,
        secp256r1VerifyInput,
      });

      await sendTransaction(ctx.connection, ixs, feePayer, ctx.sendAndConfirm);

      // Verify member was added
      const accountData = await fetchSettings(
        ctx.connection,
        address(ctx.settings)
      );
      const delegateData = await fetchMaybeDelegate(
        ctx.connection,
        await getDelegateAddress(ctx.payer.address)
      );

      expect(delegateData.exists).equal(
        false,
        "Payer should not be a delegate"
      );
      expect(accountData.data.members.length).to.equal(
        2,
        "Should have two members"
      );
      expect(
        convertMemberKeyToString(accountData.data.members[1].pubkey)
      ).to.equal(
        ctx.payer.address.toString(),
        "Second member should be the payer"
      );
      expect(accountData.data.threshold).to.equal(
        2,
        "Threshold should be updated to 2"
      );
    });

    it("should handle permission updates correctly", async () => {
      // Fund the wallet
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.01));
      // Test updating permissions for existing members
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        settings: ctx.settings,
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
        instructions
      );
      const { ixs, feePayer } = await prepareTransactionSync({
        rpc: ctx.connection,
        feePayer: ctx.payer,
        settings: ctx.settings,
        signers: [ctx.wallet, ctx.payer],
        transactionMessageBytes,
        secp256r1VerifyInput,
      });

      await sendTransaction(ctx.connection, ixs, feePayer, ctx.sendAndConfirm);

      // Verify permissions were updated
      const accountData = await fetchSettings(
        ctx.connection,
        address(ctx.settings)
      );
      const memberPermissions = accountData.data.members[1].permissions;

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
        settings: ctx.settings,
        configActions: [
          {
            type: "RemoveMembers",
            members: [ctx.payer.address],
          },
          { type: "SetThreshold", threshold: 1 },
        ],
      });

      const transactionMessageBytes = await prepareTransactionMessage(
        MULTI_WALLET_PROGRAM_ADDRESS,
        ctx.multiWalletVault,
        instructions
      );
      const { ixs, feePayer } = await prepareTransactionSync({
        rpc: ctx.connection,
        feePayer: ctx.payer,
        settings: ctx.settings,
        signers: [ctx.wallet, ctx.payer],
        transactionMessageBytes,
        secp256r1VerifyInput,
      });

      await sendTransaction(ctx.connection, ixs, feePayer, ctx.sendAndConfirm);

      // Verify member was removed
      const accountData = await fetchSettings(
        ctx.connection,
        address(ctx.settings)
      );
      const delegateData = await fetchMaybeDelegate(
        ctx.connection,
        await getDelegateAddress(ctx.payer.address)
      );

      expect(delegateData.exists).equal(
        false,
        "Payer should not be a delegate"
      );
      expect(accountData.data.members.length).to.equal(
        1,
        "Should have one member"
      );
      expect(
        convertMemberKeyToString(accountData.data.members[0].pubkey)
      ).to.equal(
        ctx.wallet.address.toString(),
        "Remaining member should be the wallet"
      );
      expect(accountData.data.threshold).to.equal(
        1,
        "Threshold should be updated to 1"
      );
    });
  });
}
