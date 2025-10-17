import {
  changeConfig,
  convertMemberKeyToString,
  createDelegates,
  fetchDelegateData,
  fetchDelegateExtensions,
  fetchSettingsData,
  getDelegateExtensionsAddress,
  getSolanaRpc,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "@revibase/wallet";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes, getUtf8Decoder } from "gill";
import {
  createMultiWallet,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runTransactionManagerTests() {
  describe("Transaction Manager Management", () => {
    let ctx: TestContext;

    // Set up a fresh context for each test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
    });

    it("should add a new member as a transaction manager", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32))
      );
      const createDelegatesIx = await createDelegates({
        payer: ctx.payer,
        createDelegateArgs: [
          {
            member: ephemeralKeypair,
            isPermanentMember: false,
            apiUrl: "https://xyz.com",
          },
        ],
      });

      await sendTransaction(
        [createDelegatesIx],
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
                pubkey: ephemeralKeypair.address,
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
      const { ixs, payer, addressLookupTableAccounts } =
        await prepareTransactionSync({
          compressed: ctx.compressed,
          payer: ctx.payer,
          index: ctx.index,
          signers: [ctx.wallet],
          transactionMessageBytes,
          secp256r1VerifyInput,
        });

      await sendTransaction(ixs, payer, addressLookupTableAccounts);

      // Verify member was added
      const delegateExtensions = await fetchDelegateExtensions(
        getSolanaRpc(),
        await getDelegateExtensionsAddress(ephemeralKeypair.address)
      );
      const accountData = await fetchSettingsData(ctx.index);
      const delegateData = await fetchDelegateData(ephemeralKeypair.address);
      const settingsIndex =
        delegateData.settingsIndex.__option === "Some"
          ? delegateData.settingsIndex.value
          : null;
      expect(
        getUtf8Decoder().decode(
          delegateExtensions.data.apiUrl.slice(
            0,
            delegateExtensions.data.apiUrlLen
          )
        )
      ).equal("https://xyz.com", "Api Url is different");
      expect(settingsIndex).equal(null, "Payer should not be a delegate");
      expect(accountData.members.length).to.equal(2, "Should have two members");
      expect(convertMemberKeyToString(accountData.members[1].pubkey)).to.equal(
        ephemeralKeypair.address.toString(),
        "Second member should be the ephemeral keypair"
      );
    });
  });
}
