import {
  changeConfig,
  convertMemberKeyToString,
  createUserAccounts,
  fetchSettingsAccountData,
  Permission,
  Permissions,
  prepareChangeConfigArgs,
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
import {
  assertTestContext,
  createMultiWallet,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runPermissionsTests(getCtx: () => TestContext) {
  it("should successfully update member permissions", async () => {
    await withErrorHandling("update member permissions", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      await addPayerAsNewMember(ctx);

      // Update permissions to only vote
      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "EditPermissions",
            members: [
              {
                member: ctx.payer.address,
                permissions: { initiate: false, vote: true, execute: false },
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

      const accountData = await fetchSettingsAccountData(ctx.index);
      const payerMember = accountData.members.find(
        (m) =>
          convertMemberKeyToString(m.pubkey) === ctx.payer.address.toString()
      );

      expect(payerMember, "Payer member should exist").to.not.be.undefined;
      expect(
        Permissions.has(payerMember!.permissions, Permission.VoteTransaction),
        "Payer should have vote permission"
      ).to.be.true;
      expect(
        Permissions.has(
          payerMember!.permissions,
          Permission.InitiateTransaction
        ),
        "Payer should not have initiate permission"
      ).to.be.false;
      expect(
        Permissions.has(
          payerMember!.permissions,
          Permission.ExecuteTransaction
        ),
        "Payer should not have execute permission"
      ).to.be.false;
    });
  });

  it("should successfully add member with only initiate permission", async () => {
    await withErrorHandling("add member with initiate only", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "AddMembers",
            members: [
              {
                member: ctx.payer.address,
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

      const accountData = await fetchSettingsAccountData(ctx.index);
      const addedMember = accountData.members.find(
        (m) =>
          convertMemberKeyToString(m.pubkey) === ctx.payer.address.toString()
      );

      expect(addedMember, "New member should exist").to.not.be.undefined;
      expect(
        Permissions.has(
          addedMember!.permissions,
          Permission.InitiateTransaction
        ),
        "New member should have initiate permission"
      ).to.be.true;
      expect(
        Permissions.has(addedMember!.permissions, Permission.VoteTransaction),
        "New member should not have vote permission"
      ).to.be.false;
      expect(
        Permissions.has(
          addedMember!.permissions,
          Permission.ExecuteTransaction
        ),
        "New member should not have execute permission"
      ).to.be.false;
    });
  });

  it("should successfully add member with all permissions", async () => {
    await withErrorHandling("add member with all permissions", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "AddMembers",
            members: [
              {
                member: ctx.payer.address,
                permissions: { initiate: true, vote: true, execute: true },
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

      const accountData = await fetchSettingsAccountData(ctx.index);
      const addedMember = accountData.members.find(
        (m) =>
          convertMemberKeyToString(m.pubkey) === ctx.payer.address.toString()
      );

      expect(addedMember, "New member should exist").to.not.be.undefined;
      expect(
        Permissions.has(
          addedMember!.permissions,
          Permission.InitiateTransaction
        ),
        "New member should have initiate permission"
      ).to.be.true;
      expect(
        Permissions.has(addedMember!.permissions, Permission.VoteTransaction),
        "New member should have vote permission"
      ).to.be.true;
      expect(
        Permissions.has(
          addedMember!.permissions,
          Permission.ExecuteTransaction
        ),
        "New member should have execute permission"
      ).to.be.true;
    });
  });

  it("should successfully update multiple members' permissions at once", async () => {
    await withErrorHandling("update multiple members permissions", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      await addPayerAsNewMember(ctx);

      const member1 = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32))
      );
      const member2 = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32))
      );

      const instruction = await createUserAccounts({
        createUserArgs: [
          {
            member: member1,
            role: UserRole.Member,
          },
          {
            member: member2,
            role: UserRole.Member,
          },
        ],
        payer: ctx.payer,
      });

      await sendTransaction([instruction], ctx.payer);

      // Add two members first
      const addMembersArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "AddMembers",
            members: [
              {
                member: member1.address,
                permissions: { initiate: true, vote: true, execute: true },
              },
              {
                member: member2.address,
                permissions: { initiate: true, vote: true, execute: true },
              },
            ],
          },
        ],
      });

      await sendTransaction(
        await changeConfig({
          signers: [ctx.wallet],
          payer: ctx.payer,
          changeConfigArgs: addMembersArgs,
        }),
        ctx.payer,
        ctx.addressLookUpTable
      );

      // Update both members' permissions
      const editPermissionsArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "EditPermissions",
            members: [
              {
                member: member1.address,
                permissions: { initiate: true, vote: false, execute: false },
              },
              {
                member: member2.address,
                permissions: { initiate: false, vote: true, execute: true },
              },
            ],
          },
        ],
      });

      await sendTransaction(
        await changeConfig({
          signers: [ctx.wallet],
          payer: ctx.payer,
          changeConfigArgs: editPermissionsArgs,
        }),
        ctx.payer,
        ctx.addressLookUpTable
      );

      const accountData = await fetchSettingsAccountData(ctx.index);
      const updatedMember1 = accountData.members.find(
        (m) => convertMemberKeyToString(m.pubkey) === member1.address.toString()
      );
      const updatedMember2 = accountData.members.find(
        (m) => convertMemberKeyToString(m.pubkey) === member2.address.toString()
      );

      expect(updatedMember1, "Member 1 should exist").to.not.be.undefined;
      expect(updatedMember2, "Member 2 should exist").to.not.be.undefined;

      expect(
        Permissions.has(
          updatedMember1!.permissions,
          Permission.InitiateTransaction
        ),
        "Member 1 should have initiate permission"
      ).to.be.true;
      expect(
        Permissions.has(
          updatedMember1!.permissions,
          Permission.VoteTransaction
        ),
        "Member 1 should not have vote permission"
      ).to.be.false;

      expect(
        Permissions.has(
          updatedMember2!.permissions,
          Permission.VoteTransaction
        ),
        "Member 2 should have vote permission"
      ).to.be.true;
      expect(
        Permissions.has(
          updatedMember2!.permissions,
          Permission.ExecuteTransaction
        ),
        "Member 2 should have execute permission"
      ).to.be.true;
    });
  });
}
