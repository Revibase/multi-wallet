import {
  createDomainUsers,
  createWallet,
  fetchGlobalCounter,
  fetchSettingsData,
  fetchUserData,
  getGlobalCounterAddress,
  getMultiWalletFromSettings,
  getSecp256r1VerifyInstruction,
  getSettingsFromIndex,
  getSolanaRpc,
  Secp256r1Key,
} from "@revibase/wallet-sdk";
import { expect } from "chai";
import {
  createMultiWallet,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
  setupTestEnvironment,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runSecp256r1Tests() {
  describe("Secp256r1 Key Management", () => {
    let ctx: TestContext;

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
    });

    it("should add a Secp256r1 key as a member", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      const settings = await getSettingsFromIndex(ctx.index);

      const secp256r1Keys = generateSecp256r1KeyPair();

      // Create Secp256r1Key
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);

      const createDomainUserIx = await createDomainUsers({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig,
        createUserArgs: [
          {
            member: secp256r1Key,
            isPermanentMember: true,
            linkedWalletSettingsIndex: Number(ctx.index),
          },
        ],
      });

      await sendTransaction(
        [createDomainUserIx],
        ctx.payer,
        ctx.addressLookUpTable
      );

      // Verify Secp256r1Key was added as member
      const accountData = await fetchSettingsData(ctx.index);

      const userData = await fetchUserData(secp256r1Key);
      const settingsIndex =
        userData.settingsIndex.__option === "Some"
          ? userData.settingsIndex.value
          : null;
      expect(settingsIndex).to.equal(
        ctx.index,
        "Delegate should be associated with the correct settings"
      );
      const multiWallet = await getMultiWalletFromSettings(settings);
      expect(multiWallet.toString()).to.equal(
        ctx.multiWalletVault.toString(),
        "Delegate should be associated with the correct vault"
      );

      expect(accountData.members.length).to.equal(1, "Should have one members");
      expect(accountData.threshold).to.equal(1, "Threshold should be 1");
    });

    it("should create wallet using Secp256r1 key as initial member", async () => {
      const secp256r1Keys = generateSecp256r1KeyPair();

      const createDomainUserIx = await createDomainUsers({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig,
        createUserArgs: [
          {
            member: new Secp256r1Key(secp256r1Keys.publicKey),
            isPermanentMember: true,
          },
        ],
      });

      await sendTransaction(
        [createDomainUserIx],
        ctx.payer,
        ctx.addressLookUpTable
      );

      const globalCounter = await fetchGlobalCounter(
        getSolanaRpc(),
        await getGlobalCounterAddress()
      );

      const settings = await getSettingsFromIndex(globalCounter.data.index);
      const mockResult = await mockAuthenticationResponse(
        getSolanaRpc(),
        {
          transactionActionType: "add_new_member",
          transactionAddress: settings.toString(),
          transactionMessageBytes: new TextEncoder().encode(ctx.rpId),
        },
        secp256r1Keys.privateKey,
        ctx
      );

      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey, {
        ...mockResult,
      });

      const { instructions, secp256r1VerifyInput } = await createWallet({
        payer: ctx.payer,
        initialMember: secp256r1Key,
        index: globalCounter.data.index,
        compressed: true,
        setAsDelegate: true,
      });

      if (secp256r1VerifyInput.length > 0) {
        instructions.unshift(
          getSecp256r1VerifyInstruction(secp256r1VerifyInput)
        );
      }

      await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);
    });
  });
}
