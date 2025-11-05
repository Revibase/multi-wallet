import {
  changeConfig,
  convertMemberKeyToString,
  DelegateOp,
  fetchSettingsAccountData,
  fetchUserAccountData,
  prepareTransactionBundle,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/core";
import { expect } from "chai";
import { createMultiWallet, sendTransaction } from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runMemberManagementTests(getCtx: () => TestContext) {
  it("should add a new member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault) return;
    await addNewMember(ctx);

    // Verify member was added
    const accountData = await fetchSettingsAccountData(
      ctx.settingsIndexWithAddress
    );
    const userAccountData = await fetchUserAccountData({
      member: ctx.payer.member.address,
      userAddressTreeIndex: ctx.payer.userAddressTreeIndex,
    });
    const settingsIndex =
      userAccountData.delegatedTo.__option === "Some"
        ? userAccountData.delegatedTo.value
        : null;
    expect(settingsIndex?.index).equal(
      ctx.settingsIndexWithAddress.index,
      "Payer should be a delegate"
    );
    expect(accountData.members.length).to.equal(2, "Should have two members");
    expect(convertMemberKeyToString(accountData.members[1].pubkey)).to.equal(
      ctx.payer.member.address.toString(),
      "Second member should be the payer"
    );
  });

  it("remove delegate permission for new member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault) return;
    // Test updating permissions for existing members
    const { instructions, secp256r1VerifyInput } = await changeConfig({
      payer: ctx.payer.member,
      compressed: ctx.compressed,
      settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
      configActionsArgs: [
        {
          type: "EditPermissions",
          members: [
            {
              account: {
                member: ctx.wallet.member.address,
                userAddressTreeIndex: ctx.wallet.userAddressTreeIndex,
              },
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
      payer: ctx.payer.member,
      settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
      creator: ctx.wallet.member,
      transactionMessageBytes,
      secp256r1VerifyInput,
      addressesByLookupTableAddress: ctx.addressLookUpTable,
    });

    for (const x of result) {
      await sendTransaction(
        x.instructions,
        x.payer,
        x.addressesByLookupTableAddress
      );
    }
    // Verify permissions were updated
    const userAccountData = await fetchUserAccountData({
      member: ctx.wallet.member.address,
      userAddressTreeIndex: ctx.wallet.userAddressTreeIndex,
    });
    expect(userAccountData.delegatedTo.__option).equal(
      "None",
      "Payer should be a delegate"
    );
  });

  it("should remove a member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault) return;

    await addNewMember(ctx);
    const { instructions, secp256r1VerifyInput } = await changeConfig({
      payer: ctx.payer.member,
      compressed: ctx.compressed,
      settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
      configActionsArgs: [
        {
          type: "RemoveMembers",
          members: [
            {
              member: ctx.payer.member.address,
              userAddressTreeIndex: ctx.payer.userAddressTreeIndex,
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
      payer: ctx.payer.member,
      settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
      creator: ctx.wallet.member,
      transactionMessageBytes,
      secp256r1VerifyInput,
      addressesByLookupTableAddress: ctx.addressLookUpTable,
    });
    for (const x of result) {
      await sendTransaction(
        x.instructions,
        x.payer,
        x.addressesByLookupTableAddress
      );
    }
    // Verify member was removed
    const accountData = await fetchSettingsAccountData(
      ctx.settingsIndexWithAddress
    );
    const userAccountData = await fetchUserAccountData({
      member: ctx.payer.member.address,
      userAddressTreeIndex: ctx.payer.userAddressTreeIndex,
    });
    const settingsIndex =
      userAccountData.delegatedTo.__option === "Some"
        ? userAccountData.delegatedTo.value
        : null;
    expect(settingsIndex).equal(null, "Payer should not be a delegate");
    expect(accountData.members.length).to.equal(1, "Should have one member");
    expect(convertMemberKeyToString(accountData.members[0].pubkey)).to.equal(
      ctx.wallet.member.address.toString(),
      "Remaining member should be the wallet"
    );
    expect(accountData.threshold).to.equal(
      1,
      "Threshold should be updated to 1"
    );
  });
}

async function addNewMember(ctx: TestContext) {
  if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault) return;
  const { instructions, secp256r1VerifyInput } = await changeConfig({
    payer: ctx.payer.member,
    compressed: ctx.compressed,
    settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
    configActionsArgs: [
      {
        type: "AddMembers",
        members: [
          {
            account: ctx.payer,
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
  const {
    instructions: ixs,
    payer,
    addressesByLookupTableAddress,
  } = await prepareTransactionSync({
    compressed: ctx.compressed,
    payer: ctx.payer.member,
    settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
    signers: [ctx.wallet.member],
    transactionMessageBytes,
    secp256r1VerifyInput,
  });

  await sendTransaction(ixs, payer, addressesByLookupTableAddress);
}
