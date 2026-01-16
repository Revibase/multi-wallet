import {
  changeConfig,
  convertMemberKeyToString,
  createDomainUserAccounts,
  fetchSettingsAccountData,
  fetchUserAccountData,
  prepareChangeConfigArgs,
  Secp256r1Key,
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import {
  assertTestContext,
  createMultiWallet,
  generateSecp256r1KeyPair,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runMemberManagementTests(getCtx: () => TestContext) {
  it("should successfully add a new member to the wallet", async () => {
    await withErrorHandling("add new member", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer"]);

      await addPayerAsNewMember(ctx);

      // Verify member was added
      const accountData = await fetchSettingsAccountData(ctx.index);
      const userAccountData = await fetchUserAccountData(ctx.payer.address);

      expect(
        userAccountData.delegatedTo.__option,
        "New member should not be a delegate initially"
      ).to.equal("None");
      expect(
        accountData.members.length,
        "Wallet should have exactly two members after adding payer"
      ).to.equal(2);
      expect(
        convertMemberKeyToString(accountData.members[1].pubkey),
        "Second member should be the payer address"
      ).to.equal(ctx.payer.address.toString());
    });
  });

  it("should remove delegate permission for a new member", async () => {
    await withErrorHandling("remove delegate permission", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      await addPayerAsNewMember(ctx);

      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "EditPermissions",
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

      // Verify permissions were updated
      const userAccountData = await fetchUserAccountData(ctx.payer.address);
      expect(
        userAccountData.delegatedTo.__option,
        "Payer should not be a delegate after permission edit"
      ).to.equal("None");
    });
  });

  it("should successfully remove a member from the wallet", async () => {
    await withErrorHandling("remove member", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, ["index", "multiWalletVault", "payer", "wallet"]);

      await addPayerAsNewMember(ctx);

      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "RemoveMembers",
            members: [
              {
                member: ctx.payer.address,
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

      // Verify member was removed
      const accountData = await fetchSettingsAccountData(ctx.index);
      const userAccountData = await fetchUserAccountData(ctx.payer.address);

      expect(
        userAccountData.delegatedTo.__option,
        "Removed member should not be a delegate"
      ).to.equal("None");
      expect(
        accountData.members.length,
        "Wallet should have exactly one member after removal"
      ).to.equal(1);
      expect(
        convertMemberKeyToString(accountData.members[0].pubkey),
        "Remaining member should be the original wallet"
      ).to.equal(ctx.wallet.address.toString());
      expect(
        accountData.threshold,
        "Threshold should be updated to 1 after member removal"
      ).to.equal(1);
    });
  });

  it("should successfully add a new Secp256r1 member to the wallet", async () => {
    await withErrorHandling("add Secp256r1 member", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, [
        "index",
        "multiWalletVault",
        "payer",
        "wallet",
        "domainConfig",
      ]);

      const secp256r1Keys = generateSecp256r1KeyPair();

      // Create Secp256r1Key
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
      const createDomainUserAccountDataIx = await createDomainUserAccounts({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig!,
        createUserArgs: {
          member: secp256r1Key,
          role: UserRole.Member,
        },
      });

      await sendTransaction(
        [createDomainUserAccountDataIx],
        ctx.payer,
        ctx.addressLookUpTable
      );

      const changeConfigArgs = await prepareChangeConfigArgs({
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs: [
          {
            type: "AddMembers",
            members: [
              {
                member: secp256r1Key,
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

      // Verify member was added
      const accountData = await fetchSettingsAccountData(ctx.index);
      const userAccountData = await fetchUserAccountData(secp256r1Key);

      expect(
        userAccountData.delegatedTo.__option,
        "Secp256r1 member should not be a delegate initially"
      ).to.equal("None");
      expect(
        accountData.members.length,
        "Wallet should have exactly two members after adding Secp256r1 member"
      ).to.equal(2);
      expect(
        convertMemberKeyToString(accountData.members[1].pubkey),
        "Second member should be the Secp256r1 key"
      ).to.equal(secp256r1Key.toString());
    });
  });
}
