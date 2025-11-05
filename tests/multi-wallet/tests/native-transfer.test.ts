import {
  createDomainUserAccounts,
  createUserAccounts,
  getSolanaRpc,
  nativeTransferIntent,
  Secp256r1Key,
} from "@revibase/core";
import { expect } from "chai";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getU64Encoder,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS } from "gill/programs";
import {
  createMultiWallet,
  fundMultiWalletVault,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runNativeTransferTest(getCtx: () => TestContext) {
  it("should transfer sol", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault) return;
    await fundMultiWalletVault(ctx, BigInt(10 ** 8));
    try {
      const nativeTransfer = await nativeTransferIntent({
        settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
        payer: ctx.payer.member,
        signers: [ctx.wallet.member],
        destination: ctx.wallet.member.address,
        amount: 10 ** 6,
        compressed: ctx.compressed,
      });

      await sendTransaction(
        [...nativeTransfer],
        ctx.payer.member,
        ctx.addressLookUpTable
      );

      const data = await getSolanaRpc()
        .getAccountInfo(ctx.multiWalletVault)
        .send();

      expect(Number(data.value?.lamports)).to.equal(
        10 ** 8 - 10 ** 6,
        "Incorrect sol balance"
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("should transfer sol with secp256r1 signer", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault) return;
    await fundMultiWalletVault(ctx, BigInt(10 ** 8));
    //create transaction manger
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

    // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
    const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
    const {
      instruction: createDomainUserAccountIx,
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
      [createDomainUserAccountIx],
      ctx.payer.member,
      ctx.addressLookUpTable
    );

    try {
      const signedSigner = await mockAuthenticationResponse(
        getSolanaRpc(),
        {
          transactionActionType: "transfer_intent",
          transactionAddress: SYSTEM_PROGRAM_ADDRESS.toString(),
          transactionMessageBytes: new Uint8Array([
            ...getU64Encoder().encode(BigInt(10 ** 6)),
            ...getAddressEncoder().encode(ctx.wallet.member.address),
            ...getAddressEncoder().encode(SYSTEM_PROGRAM_ADDRESS),
          ]),
        },
        secp256r1Keys.privateKey,
        secp256r1Keys.publicKey,
        secp256r1AddressTree,
        ctx
      );

      const nativeTransfer = await nativeTransferIntent({
        settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
        payer: ctx.payer.member,
        signers: [signedSigner, transactionManager],
        destination: ctx.wallet.member.address,
        amount: 10 ** 6,
        compressed: ctx.compressed,
      });

      await sendTransaction(
        [...nativeTransfer],
        ctx.payer.member,
        ctx.addressLookUpTable
      );

      const data = await getSolanaRpc()
        .getAccountInfo(ctx.multiWalletVault)
        .send();

      expect(Number(data.value?.lamports)).to.equal(
        10 ** 8 - 10 ** 6,
        "Incorrect sol balance"
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
}
