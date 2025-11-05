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
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault) return;
    const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const { instruction: createUserAccountIx, userAddressTreeIndex } =
      await createUserAccounts({
        payer: ctx.payer.member,
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
      ctx.payer.member,
      ctx.addressLookUpTable
    );

    const secp256r1Keys = generateSecp256r1KeyPair();

    // Create Secp256r1Key
    const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
    const {
      instruction: createDomainUserAccountDataIx,
      userAddressTreeIndex: secp256r1AddressTree,
    } = await createDomainUserAccounts({
      payer: ctx.payer.member,
      authority: ctx.wallet.member,
      domainConfig: ctx.domainConfig,
      createUserArgs: {
        member: secp256r1Key,
        isPermanentMember: true,
        settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
        transactionManager: {
          member: transactionManager.address,
          userAddressTreeIndex,
        },
      },
    });

    await sendTransaction(
      [createDomainUserAccountDataIx],
      ctx.payer.member,
      ctx.addressLookUpTable
    );

    // Verify Secp256r1Key was added as member
    const accountData = await fetchSettingsAccountData(
      ctx.settingsIndexWithAddress
    );

    const userAccountData = await fetchUserAccountData({
      member: secp256r1Key,
      userAddressTreeIndex: secp256r1AddressTree,
    });
    const settingsIndex =
      userAccountData.delegatedTo.__option === "Some"
        ? userAccountData.delegatedTo.value
        : null;
    expect(settingsIndex?.index).to.equal(
      ctx.settingsIndexWithAddress.index,
      "User should be associated with the correct settings"
    );
    const walletAddress = await getWalletAddressFromIndex(
      ctx.settingsIndexWithAddress.index
    );
    expect(walletAddress.toString()).to.equal(
      ctx.multiWalletVault.toString(),
      "User should be associated with the correct vault"
    );

    expect(accountData.members.length).to.equal(2, "Should have two members");
    expect(accountData.threshold).to.equal(1, "Threshold should be 1");
  });

  it("should create wallet using Secp256r1 key as initial member", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    const secp256r1Keys = generateSecp256r1KeyPair();

    const { instruction: createDomainUserAccountIx, userAddressTreeIndex } =
      await createDomainUserAccounts({
        payer: ctx.payer.member,
        authority: ctx.wallet.member,
        domainConfig: ctx.domainConfig,
        createUserArgs: {
          member: new Secp256r1Key(secp256r1Keys.publicKey),
          isPermanentMember: true,
        },
      });

    await sendTransaction(
      [createDomainUserAccountIx],
      ctx.payer.member,
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
      userAddressTreeIndex,
      ctx
    );

    const { instructions, secp256r1VerifyInput } = await createWallet({
      payer: ctx.payer.member,
      initialMember: {
        member: signedSigner,
        userAddressTreeIndex,
      },
      index: globalCounter.data.index,
      setAsDelegate: true,
    });

    if (secp256r1VerifyInput.length > 0) {
      instructions.unshift(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
    }

    await sendTransaction(
      instructions,
      ctx.payer.member,
      ctx.addressLookUpTable
    );
  });
}
