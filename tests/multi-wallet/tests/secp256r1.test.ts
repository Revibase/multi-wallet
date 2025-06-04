import {
  changeConfig,
  fetchDelegate,
  fetchSettings,
  getDelegateAddress,
  getMultiWalletFromSettings,
  Permissions,
  Secp256r1Key,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
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
      // Mock authentication response
      const mockResult = await mockAuthenticationResponse(
        ctx.connection,
        {
          transactionActionType: "add_new_member",
          transactionAddress: ctx.settings,
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
      const changeConfigIxs = await changeConfig({
        signers: [ctx.wallet],
        feePayer: ctx.payer,
        settings: ctx.settings,
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

      const tx = await sendTransaction(
        ctx.connection,
        changeConfigIxs,
        ctx.payer,
        ctx.sendAndConfirm
      );

      // Verify Secp256r1Key was added as member
      const accountData = await fetchSettings(ctx.connection, ctx.settings);

      const delegateData = await fetchDelegate(
        ctx.connection,
        await getDelegateAddress(secp256r1Key)
      );

      expect(delegateData.data.multiWalletSettings.toString()).to.equal(
        ctx.settings.toString(),
        "Delegate should be associated with the correct settings"
      );
      const multiWallet = await getMultiWalletFromSettings(
        delegateData.data.multiWalletSettings
      );
      expect(multiWallet.toString()).to.equal(
        ctx.multiWalletVault.toString(),
        "Delegate should be associated with the correct vault"
      );

      expect(accountData.data.members.length).to.equal(
        2,
        "Should have two members"
      );
      expect(accountData.data.threshold).to.equal(1, "Threshold should be 1");
    });
  });
}
