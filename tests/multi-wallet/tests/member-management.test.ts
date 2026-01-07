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
  createMultiWallet,
  generateSecp256r1KeyPair,
  sendTransaction,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runMemberManagementTests(getCtx: () => TestContext) {
  it("should add a new member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.index || !ctx.multiWalletVault || !ctx.payer) return;
    await addPayerAsNewMember(ctx);

    // Verify member was added
    const accountData = await fetchSettingsAccountData(ctx.index);
    const userAccountData = await fetchUserAccountData(ctx.payer.address);

    expect(userAccountData.delegatedTo.__option).equal(
      "None",
      "Payer should not be a delegate"
    );
    expect(accountData.members.length).to.equal(2, "Should have two members");
    expect(convertMemberKeyToString(accountData.members[1].pubkey)).to.equal(
      ctx.payer.address.toString(),
      "Second member should be the payer"
    );
  });

  it("remove delegate permission for new member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.index || !ctx.multiWalletVault || !ctx.payer || !ctx.wallet)
      return;
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
    expect(userAccountData.delegatedTo.__option).equal(
      "None",
      "Payer should not be a delegate"
    );
  });

  it("should remove a member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.index || !ctx.multiWalletVault || !ctx.payer || !ctx.wallet)
      return;

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
    expect(userAccountData.delegatedTo.__option).equal(
      "None",
      "Payer should not be a delegate"
    );
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

  it("should add a new Secp256r1 member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (
      !ctx.index ||
      !ctx.multiWalletVault ||
      !ctx.payer ||
      !ctx.wallet ||
      !ctx.domainConfig
    )
      return;

    const secp256r1Keys = generateSecp256r1KeyPair();

    // Create Secp256r1Key
    const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
    const createDomainUserAccountDataIx = await createDomainUserAccounts({
      payer: ctx.payer,
      authority: ctx.wallet,
      domainConfig: ctx.domainConfig,
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

    expect(userAccountData.delegatedTo.__option).equal(
      "None",
      "Payer should not be a delegate"
    );
    expect(accountData.members.length).to.equal(2, "Should have two members");
    expect(convertMemberKeyToString(accountData.members[1].pubkey)).to.equal(
      secp256r1Key.toString(),
      "Second member should be the payer"
    );
  });
}
