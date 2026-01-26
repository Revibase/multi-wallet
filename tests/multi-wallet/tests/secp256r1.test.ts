import {
  bufferToBase64URLString,
  changeConfig,
  createDomainUserAccounts,
  createUserAccounts,
  fetchSettingsAccountData,
  fetchUserAccountData,
  getSettingsFromIndex,
  getWalletAddressFromIndex,
  prepareChangeConfigArgs,
  Secp256r1Key,
  serializeConfigActions,
  Transports,
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
import { TEST_TRANSACTION_MANAGER_URL } from "../constants.ts";
import {
  assertTestContext,
  createMultiWallet,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runSecp256r1Tests(getCtx: () => TestContext) {
  it("should successfully initialize a wallet for Secp256r1 member with a transaction manager", async () => {
    await withErrorHandling(
      "initialize Secp256r1 wallet with transaction manager",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "wallet",
          "payer",
          "domainConfig",
        ]);

        const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
          crypto.getRandomValues(new Uint8Array(32)),
        );
        const createUserAccountIx = await createUserAccounts({
          payer: ctx.payer,
          createUserArgs: [
            {
              member: transactionManager,
              role: UserRole.TransactionManager,
              transactionManagerUrl: TEST_TRANSACTION_MANAGER_URL,
            },
          ],
        });

        await sendTransaction(
          [createUserAccountIx],
          ctx.payer,
          ctx.addressLookUpTable,
        );

        const secp256r1Keys = generateSecp256r1KeyPair();
        const credentialId = bufferToBase64URLString(
          crypto.getRandomValues(new Uint8Array(64)),
        );
        // Create Secp256r1Key
        const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
        const createDomainUserAccountDataIx = await createDomainUserAccounts({
          payer: ctx.payer,
          authority: ctx.wallet,
          domainConfig: ctx.domainConfig!,
          createUserArgs: {
            member: secp256r1Key,
            role: UserRole.Member,
            index: ctx.index,
            transactionManager: {
              member: transactionManager.address,
            },
            credentialId,
            transports: [Transports.Internal, Transports.Hybrid],
          },
        });

        await sendTransaction(
          [createDomainUserAccountDataIx],
          ctx.payer,
          ctx.addressLookUpTable,
        );

        // Verify Secp256r1Key was added as member
        const accountData = await fetchSettingsAccountData(ctx.index);
        const userAccountData = await fetchUserAccountData(secp256r1Key);
        const settingsIndex =
          userAccountData.wallets.find((x) => x.isDelegate) ?? null;

        expect(
          settingsIndex?.index,
          "Secp256r1 user should be associated with the correct settings index",
        ).to.equal(ctx.index);

        const walletAddress = await getWalletAddressFromIndex(ctx.index);
        expect(
          walletAddress.toString(),
          "User should be associated with the correct vault address",
        ).to.equal(ctx.multiWalletVault.toString());

        expect(
          accountData.members.length,
          "Wallet should have exactly two members after adding Secp256r1 member",
        ).to.equal(2);
        expect(accountData.threshold, "Wallet threshold should be 1").to.equal(
          1,
        );
      },
    );
  });

  it("should initialize a wallet for Secp256r1 member and add payer as member using Secp256r1 signature", async () => {
    await withErrorHandling(
      "initialize Secp256r1 wallet and add payer",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "wallet",
          "payer",
          "domainConfig",
        ]);

        const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
          crypto.getRandomValues(new Uint8Array(32)),
        );
        const createUserAccountIx = await createUserAccounts({
          payer: ctx.payer,
          createUserArgs: [
            {
              member: transactionManager,
              role: UserRole.TransactionManager,
              transactionManagerUrl: TEST_TRANSACTION_MANAGER_URL,
            },
          ],
        });

        await sendTransaction(
          [createUserAccountIx],
          ctx.payer,
          ctx.addressLookUpTable,
        );

        const secp256r1Keys = generateSecp256r1KeyPair();
        const credentialId = bufferToBase64URLString(
          crypto.getRandomValues(new Uint8Array(64)),
        );
        // Create Secp256r1Key
        const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
        const createDomainUserAccountDataIx = await createDomainUserAccounts({
          payer: ctx.payer,
          authority: ctx.wallet,
          domainConfig: ctx.domainConfig!,
          createUserArgs: {
            member: secp256r1Key,
            role: UserRole.Member,
            index: ctx.index,
            credentialId,
            transports: [Transports.Internal, Transports.Hybrid],
          },
        });

        await sendTransaction(
          [createDomainUserAccountDataIx],
          ctx.payer,
          ctx.addressLookUpTable,
        );

        const changeConfigArgs = await prepareChangeConfigArgs({
          compressed: ctx.compressed,
          index: ctx.index,
          configActionsArgs: [
            {
              type: "AddMembers",
              members: [
                {
                  member: ctx.payer.address,
                  permissions: { initiate: true, vote: true, execute: true },
                },
              ],
            },
          ],
        });

        const signedSigner = await mockAuthenticationResponse(
          {
            transactionActionType: "change_config",
            transactionAddress: (
              await getSettingsFromIndex(ctx.index)
            ).toString(),
            transactionMessageBytes: new Uint8Array(
              serializeConfigActions(changeConfigArgs.configActions),
            ),
          },
          secp256r1Keys.privateKey,
          secp256r1Keys.publicKey,
          ctx,
        );

        const instructions = await changeConfig({
          signers: [signedSigner],
          payer: ctx.payer,
          changeConfigArgs,
        });

        await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);

        // Verify payer was added as member
        const accountData = await fetchSettingsAccountData(ctx.index);
        expect(
          accountData.members.length,
          "Wallet should have at least two members after adding payer",
        ).to.be.at.least(2);
      },
    );
  });
}
