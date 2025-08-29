import {
  changeConfig,
  ConfigurationArgs,
  createDomainUsers,
  createWallet,
  DelegateOp,
  fetchGlobalCounter,
  fetchSettingsData,
  fetchUserData,
  getGlobalCounterAddress,
  getMultiWalletFromSettings,
  getSecp256r1VerifyInstruction,
  getSettingsFromIndex,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Permissions,
  prepareTransactionBundle,
  prepareTransactionMessage,
  Secp256r1Key,
  Transport,
} from "@revibase/wallet-sdk";
import { getAddressDecoder } from "@solana/kit";
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

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
    });

    it("should add a Secp256r1 key as a member", async () => {
      const settings = await getSettingsFromIndex(ctx.index);

      const secp256r1Keys = generateSecp256r1KeyPair();
      // Mock authentication response
      const mockResult = await mockAuthenticationResponse(
        ctx.connection,
        {
          transactionActionType: "add_new_member",
          transactionAddress: settings,
          transactionMessageBytes: new TextEncoder().encode(ctx.rpId),
        },
        secp256r1Keys.privateKey,
        ctx
      );

      // Create Secp256r1Key
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey, {
        ...mockResult,
      });

      const createDomainUserIx = await createDomainUsers({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: mockResult.domainConfig,
        createUserArgs: [
          {
            member: secp256r1Key,
            isPermanentMember: false,
            username: "hello",
            credentialId: crypto.getRandomValues(new Uint8Array(32)),
            transports: [Transport.Nfc],
            mint: getAddressDecoder().decode(
              crypto.getRandomValues(new Uint8Array(32))
            ),
          },
        ],
      });

      await sendTransaction(
        ctx.connection,
        [createDomainUserIx],
        ctx.payer,
        ctx.sendAndConfirm,
        ctx.addressLookUpTable
      );
      const configActionsArgs: ConfigurationArgs[] = [
        {
          type: "AddMembers",
          members: [
            {
              pubkey: secp256r1Key,
              permissions: Permissions.all(),
              setAsDelegate: false,
            },
          ],
        },
        {
          type: "EditPermissions",
          members: [
            {
              pubkey: ctx.wallet.address,
              permissions: Permissions.fromPermissions([]),
              delegateOperation: DelegateOp.Ignore,
            },
          ],
        },
      ];

      // Add Secp256r1Key as member
      const { instructions, secp256r1VerifyInput } = await changeConfig({
        payer: ctx.payer,
        compressed: ctx.compressed,
        index: ctx.index,
        configActionsArgs,
      });

      const transactionMessageBytes = prepareTransactionMessage(
        MULTI_WALLET_PROGRAM_ADDRESS.toString(),
        ctx.payer.address,
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

      const userData = await fetchUserData(secp256r1Key);
      const settingsIndex =
        userData.settingsIndex.__option === "Some"
          ? userData.settingsIndex.value
          : null;
      expect(settingsIndex).to.equal(
        null,
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

    it("should create wallet using Secp256r1 key as initial member", async () => {
      const secp256r1Keys = generateSecp256r1KeyPair();

      // Mock authentication response
      const mockResult = await mockAuthenticationResponse(
        ctx.connection,
        {
          transactionActionType: "create_new_wallet",
          transactionAddress: ctx.domainConfig.toString(),
          transactionMessageBytes: new TextEncoder().encode(ctx.rpId),
        },
        secp256r1Keys.privateKey,
        ctx
      );

      // Create Secp256r1Key
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey, {
        ...mockResult,
      });

      const createDomainUserIx = await createDomainUsers({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig,
        createUserArgs: [
          {
            member: secp256r1Key,
            isPermanentMember: true,
            username: "hello",
            credentialId: crypto.getRandomValues(new Uint8Array(32)),
            transports: [Transport.Nfc],
            mint: getAddressDecoder().decode(
              crypto.getRandomValues(new Uint8Array(32))
            ),
          },
        ],
      });

      await sendTransaction(
        ctx.connection,
        [createDomainUserIx],
        ctx.payer,
        ctx.sendAndConfirm,
        ctx.addressLookUpTable
      );

      const globalCounter = await fetchGlobalCounter(
        ctx.connection,
        await getGlobalCounterAddress()
      );
      const { instructions, secp256r1VerifyInput } = await createWallet({
        payer: ctx.payer,
        initialMember: secp256r1Key,
        permissions: Permissions.all(),
        index: globalCounter.data.index,
        compressed: true,
      });

      if (secp256r1VerifyInput.length > 0) {
        instructions.unshift(
          getSecp256r1VerifyInstruction(secp256r1VerifyInput)
        );
      }

      await sendTransaction(
        ctx.connection,
        instructions,
        ctx.payer,
        ctx.sendAndConfirm,
        ctx.addressLookUpTable
      );
    });
  });
}
