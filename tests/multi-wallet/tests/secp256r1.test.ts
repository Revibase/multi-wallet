import {
  changeConfig,
  fetchMaybeDelegate,
  fetchSettingsData,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Permissions,
  prepareTransactionBundle,
  prepareTransactionMessage,
  Secp256r1Key,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  fundMultiWalletVault,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers";
import type { TestContext } from "../types";

export function runSecp256r1Tests() {
  describe("Secp256r1 Key Management", () => {
    let ctx: TestContext;
    let secp256r1Keys: { privateKey: Uint8Array; publicKey: Uint8Array };

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
      secp256r1Keys = generateSecp256r1KeyPair();
    });

    it("should add a Secp256r1 key as a member", async () => {
      // Fund the wallet
      await fundMultiWalletVault(ctx, BigInt(10 ** 9 * 0.01));
      const settings = await getSettingsFromIndex(ctx.index);
      // Mock authentication response
      const mockResult = await mockAuthenticationResponse(
        ctx.connection,
        {
          transactionActionType: "add_new_member",
          transactionAddress: settings,
          transactionMessageBytes: new TextEncoder().encode(ctx.rpId),
        },
        secp256r1Keys.privateKey,
        secp256r1Keys.publicKey,
        ctx
      );

      // Create Secp256r1Key
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey, {
        ...mockResult,
      });

      // Add Secp256r1Key as member
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        compressed: ctx.compressed,
        index: ctx.index,
        configActions: [
          {
            type: "AddMembers",
            members: [
              {
                pubkey: secp256r1Key,
                permissions: Permissions.all(),
              },
            ],
          },
        ],
      });

      const transactionMessageBytes = await prepareTransactionMessage(
        MULTI_WALLET_PROGRAM_ADDRESS.toString(),
        ctx.multiWalletVault,
        instructions,
        ctx.addressLookUpTable
      );

      const result = await prepareTransactionBundle({
        compressed: ctx.compressed,
        payer: ctx.payer,
        index: ctx.index,
        creator: ctx.wallet,
        transactionMessageBytes,
        secp256r1VerifyInput,
      });
      for (const x of result) {
        console.log(x.id);
        await sendTransaction(
          ctx.connection,
          x.ixs,
          x.payer,
          ctx.sendAndConfirm,
          x.addressLookupTableAccounts
        );
      }
      // Verify Secp256r1Key was added as member
      const accountData = await fetchSettingsData(ctx.index);

      const delegateData = await fetchMaybeDelegate(secp256r1Key);

      expect(Number(delegateData.index)).to.equal(
        Number(ctx.index),
        "Delegate should be associated with the correct settings"
      );
      const multiWallet = await getMultiWalletFromSettings(settings);
      expect(multiWallet.toString()).to.equal(
        ctx.multiWalletVault.toString(),
        "Delegate should be associated with the correct vault"
      );

      expect(accountData.members.length).to.equal(2, "Should have two members");
      expect(accountData.threshold).to.equal(1, "Threshold should be 1");
    });
  });
}
