import {
  createDomainUserAccounts,
  createUserAccounts,
  createWallet,
  fetchGlobalCounter,
  fetchSettingsAccountData,
  fetchUserAccountData,
  getGlobalCounterAddress,
  getSecp256r1VerifyInstruction,
  getSettingsFromIndex,
  getSolanaRpc,
  getWalletAddressFromIndex,
  Secp256r1Key,
} from "@revibase/wallet";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
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

    it("should initialize a wallet for Secp256r1 with a transaction manager", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
        crypto.getRandomValues(new Uint8Array(32))
      );
      const createUserAccountIx = await createUserAccounts({
        payer: ctx.payer,
        createUserArgs: [
          {
            member: transactionManager,
            isPermanentMember: false,
            transactionManagerUrl: "https://xyz.com",
          },
        ],
      });

      await sendTransaction(
        [createUserAccountIx],
        ctx.payer,
        ctx.addressLookUpTable
      );

      const secp256r1Keys = generateSecp256r1KeyPair();

      // Create Secp256r1Key
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
      const createDomainUserAccountDataIx = await createDomainUserAccounts({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig,
        createUserArgs: {
          member: secp256r1Key,
          isPermanentMember: true,
          settingsIndex: Number(ctx.index),
          transactionManager: transactionManager.address,
        },
      });

      await sendTransaction(
        [createDomainUserAccountDataIx],
        ctx.payer,
        ctx.addressLookUpTable
      );

      // Verify Secp256r1Key was added as member
      const accountData = await fetchSettingsAccountData(ctx.index);

      const userAccountData = await fetchUserAccountData(secp256r1Key);
      const settingsIndex =
        userAccountData.settingsIndex.__option === "Some"
          ? userAccountData.settingsIndex.value
          : null;
      expect(settingsIndex).to.equal(
        ctx.index,
        "User should be associated with the correct settings"
      );
      const walletAddress = await getWalletAddressFromIndex(ctx.index);
      expect(walletAddress.toString()).to.equal(
        ctx.multiWalletVault.toString(),
        "User should be associated with the correct vault"
      );

      expect(accountData.members.length).to.equal(2, "Should have two members");
      expect(accountData.threshold).to.equal(1, "Threshold should be 1");
    });

    it("should create wallet using Secp256r1 key as initial member", async () => {
      const secp256r1Keys = generateSecp256r1KeyPair();

      const createDomainUserAccountIx = await createDomainUserAccounts({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig,
        createUserArgs: {
          member: new Secp256r1Key(secp256r1Keys.publicKey),
          isPermanentMember: true,
        },
      });

      await sendTransaction(
        [createDomainUserAccountIx],
        ctx.payer,
        ctx.addressLookUpTable
      );

      const globalCounter = await fetchGlobalCounter(
        getSolanaRpc(),
        await getGlobalCounterAddress()
      );

      const settings = await getSettingsFromIndex(globalCounter.data.index);
      const signedSigner = await mockAuthenticationResponse(
        getSolanaRpc(),
        {
          transactionActionType: "add_new_member",
          transactionAddress: settings.toString(),
          transactionMessageBytes: new TextEncoder().encode(ctx.rpId),
        },
        secp256r1Keys.privateKey,
        secp256r1Keys.publicKey,
        ctx
      );

      const { instructions, secp256r1VerifyInput } = await createWallet({
        payer: ctx.payer,
        initialMember: signedSigner,
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
