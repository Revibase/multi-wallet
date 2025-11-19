import {
  changeConfig,
  convertMemberKeyToString,
  createUserAccounts,
  DelegateOp,
  fetchSettingsAccountData,
  fetchUserAccountData,
  prepareTransactionMessage,
  prepareTransactionSync,
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
import { createMultiWallet, sendTransaction } from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runTransactionManagerTests(getCtx: () => TestContext) {
  it("should add a new member as a transaction manager", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.index || !ctx.multiWalletVault || !ctx.wallet || !ctx.payer)
      return;
    const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const createUserAccountIx = await createUserAccounts({
      payer: ctx.payer,
      createUserArgs: [
        {
          member: ephemeralKeypair,
          role: UserRole.TransactionManager,
          transactionManagerUrl: "https://xyz.com",
        },
      ],
    });

    await sendTransaction(
      [createUserAccountIx],
      ctx.payer,
      ctx.addressLookUpTable
    );

    const { instructions, secp256r1VerifyInput } = await changeConfig({
      payer: ctx.payer,
      compressed: ctx.compressed,
      index: ctx.index,
      configActionsArgs: [
        {
          type: "AddMembers",
          members: [
            {
              member: ephemeralKeypair.address,
              permissions: { initiate: true, vote: false, execute: false },
              delegateOperation: DelegateOp.Ignore,
              isTransactionManager: true,
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

    // Verify member was added
    const userAccountData = await fetchUserAccountData(
      ephemeralKeypair.address
    );
    const accountData = await fetchSettingsAccountData(ctx.index);
    const settingsIndex =
      userAccountData.delegatedTo.__option === "Some"
        ? userAccountData.delegatedTo.value
        : null;
    if (userAccountData.transactionManagerUrl.__option === "None") {
      throw new Error("No transaction manager url found.");
    }
    expect(userAccountData.transactionManagerUrl.value).equal(
      "https://xyz.com",
      "Transaction Manager Url not found"
    );
    expect(settingsIndex).equal(null, "Payer should not be a delegate");
    expect(accountData.members.length).to.equal(2, "Should have two members");
    expect(convertMemberKeyToString(accountData.members[1].pubkey)).to.equal(
      ephemeralKeypair.address.toString(),
      "Second member should be the ephemeral keypair"
    );
  });
}
