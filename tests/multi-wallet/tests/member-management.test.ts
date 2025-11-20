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
    if (!ctx.index || !ctx.multiWalletVault || !ctx.payer) return;
    await addNewMember(ctx);

    // Verify member was added
    const accountData = await fetchSettingsAccountData(ctx.index);
    const userAccountData = await fetchUserAccountData(ctx.payer.address);
    const settingsIndex =
      userAccountData.delegatedTo.__option === "Some"
        ? userAccountData.delegatedTo.value
        : null;
    expect(settingsIndex?.index).equal(ctx.index, "Payer should be a delegate");
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
    await addNewMember(ctx);
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
              member: ctx.payer.address,
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
    const userAccountData = await fetchUserAccountData(ctx.wallet.address);
    expect(userAccountData.delegatedTo.__option).equal(
      "None",
      "Payer should be a delegate"
    );
  });

  it("should remove a member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.index || !ctx.multiWalletVault || !ctx.payer || !ctx.wallet)
      return;

    await addNewMember(ctx);
    const { instructions, secp256r1VerifyInput } = await changeConfig({
      payer: ctx.payer,
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
    const accountData = await fetchSettingsAccountData(ctx.index);
    const userAccountData = await fetchUserAccountData(ctx.payer.address);
    const settingsIndex =
      userAccountData.delegatedTo.__option === "Some"
        ? userAccountData.delegatedTo.value
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
}

async function addNewMember(ctx: TestContext) {
  if (!ctx.index || !ctx.multiWalletVault || !ctx.payer || !ctx.wallet) return;
  const { instructions, secp256r1VerifyInput } = await changeConfig({
    payer: ctx.payer,
    compressed: ctx.compressed,
    index: ctx.index,
    configActionsArgs: [
      {
        type: "AddMembers",
        members: [
          {
            member: ctx.payer,
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
  const {
    instructions: ixs,
    payer,
    addressesByLookupTableAddress,
  } = await prepareTransactionSync({
    compressed: ctx.compressed,
    payer: ctx.payer,
    index: ctx.index,
    signers: [ctx.wallet],
    transactionMessageBytes,
    secp256r1VerifyInput,
  });

  await sendTransaction(ixs, payer, addressesByLookupTableAddress);
}
