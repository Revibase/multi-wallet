import {
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
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
import {
  createMultiWallet,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runSecp256r1Tests(getCtx: () => TestContext) {
  it("should initialize a wallet for Secp256r1 with a transaction manager", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (
      !ctx.index ||
      !ctx.multiWalletVault ||
      !ctx.wallet ||
      !ctx.payer ||
      !ctx.domainConfig
    )
      return;
    const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const createUserAccountIx = await createUserAccounts({
      payer: ctx.payer,
      createUserArgs: [
        {
          member: transactionManager,
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

    const secp256r1Keys = generateSecp256r1KeyPair();

    // Create Secp256r1Key
    const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
    const createDomainUserAccountDataIx = await createDomainUserAccounts({
      payer: ctx.payer,
      authority: ctx.wallet,
      domainConfig: ctx.domainConfig,
      createUserArgs: {
        member: secp256r1Key,
        role: UserRole.Member,
        index: ctx.index,
        transactionManager: {
          member: transactionManager.address,
        },
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
      userAccountData.delegatedTo.__option === "Some"
        ? userAccountData.delegatedTo.value
        : null;
    expect(settingsIndex?.index).to.equal(
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

  it("should initialize a wallet for Secp256r1 member & add payer as member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (
      !ctx.index ||
      !ctx.multiWalletVault ||
      !ctx.wallet ||
      !ctx.payer ||
      !ctx.domainConfig
    )
      return;
    const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const createUserAccountIx = await createUserAccounts({
      payer: ctx.payer,
      createUserArgs: [
        {
          member: transactionManager,
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

    const secp256r1Keys = generateSecp256r1KeyPair();

    // Create Secp256r1Key
    const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
    const createDomainUserAccountDataIx = await createDomainUserAccounts({
      payer: ctx.payer,
      authority: ctx.wallet,
      domainConfig: ctx.domainConfig,
      createUserArgs: {
        member: secp256r1Key,
        role: UserRole.Member,
        index: ctx.index,
      },
    });

    await sendTransaction(
      [createDomainUserAccountDataIx],
      ctx.payer,
      ctx.addressLookUpTable
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
        transactionAddress: (await getSettingsFromIndex(ctx.index)).toString(),
        transactionMessageBytes: serializeConfigActions(
          changeConfigArgs.configActions
        ),
      },
      secp256r1Keys.privateKey,
      secp256r1Keys.publicKey,
      ctx
    );

    const instructions = await changeConfig({
      signers: [signedSigner],
      payer: ctx.payer,
      changeConfigArgs,
    });

    await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);
  });
}
