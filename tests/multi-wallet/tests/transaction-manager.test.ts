import {
  changeConfig,
  convertMemberKeyToString,
  createUserAccounts,
  fetchSettingsAccountData,
  fetchUserAccountData,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/core";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
import { createMultiWallet, sendTransaction } from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runTransactionManagerTests(getCtx: () => TestContext) {
  it("should add a new member as a transaction manager", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault) return;
    const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const { instruction: createUserAccountIx, userAddressTreeIndex } =
      await createUserAccounts({
        payer: ctx.payer.member,
        createUserArgs: [
          {
            member: ephemeralKeypair,
            isPermanentMember: false,
            transactionManagerUrl: "https://xyz.com",
          },
        ],
      });

    await sendTransaction(
      [createUserAccountIx],
      ctx.payer.member,
      ctx.addressLookUpTable
    );

    const { instructions, secp256r1VerifyInput } = await changeConfig({
      payer: ctx.payer.member,
      compressed: ctx.compressed,
      settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
      configActionsArgs: [
        {
          type: "AddMembers",
          members: [
            {
              account: {
                member: ephemeralKeypair.address,
                userAddressTreeIndex,
              },
              permissions: { initiate: true, vote: false, execute: false },
              setAsDelegate: false,
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
      payer: ctx.payer.member,
      settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
      signers: [ctx.wallet.member],
      transactionMessageBytes,
      secp256r1VerifyInput,
    });

    await sendTransaction(ixs, payer, addressesByLookupTableAddress);

    // Verify member was added
    const userAccountData = await fetchUserAccountData({
      member: ephemeralKeypair.address,
      userAddressTreeIndex,
    });
    const accountData = await fetchSettingsAccountData(
      ctx.settingsIndexWithAddress
    );
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
