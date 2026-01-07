import {
  createDomainUserAccounts,
  createUserAccounts,
  editUserDelegate,
  getSolanaRpc,
  nativeTransferIntent,
  Secp256r1Key,
  UserRole,
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
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runNativeTransferTest(getCtx: () => TestContext) {
  it("add payer as new member and transfer sol", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    if (!ctx.index || !ctx.multiWalletVault || !ctx.wallet || !ctx.payer)
      return;
    await fundMultiWalletVault(ctx, BigInt(10 ** 8));
    try {
      await addPayerAsNewMember(ctx);
      const instructions = await editUserDelegate({
        payer: ctx.payer,
        user: ctx.payer,
        newDelegate: { index: BigInt(ctx.index), settingsAddressTreeIndex: 0 },
      });
      await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);

      const nativeTransfer = await nativeTransferIntent({
        index: ctx.index,
        payer: ctx.payer,
        signers: [ctx.payer],
        destination: ctx.wallet.address,
        amount: 10 ** 6,
        compressed: ctx.compressed,
      });

      await sendTransaction(
        [...nativeTransfer],
        ctx.payer,
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

  it("should fail when trying to submit two transactions with the same intent", async () => {
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
    await fundMultiWalletVault(ctx, BigInt(10 ** 8));

    const secp256r1Keys = generateSecp256r1KeyPair();

    // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
    const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
    const createDomainUserAccountIx = await createDomainUserAccounts({
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
      [createDomainUserAccountIx],
      ctx.payer,
      ctx.addressLookUpTable
    );

    try {
      const signedSigner = await mockAuthenticationResponse(
        {
          transactionActionType: "transfer_intent",
          transactionAddress: SYSTEM_PROGRAM_ADDRESS.toString(),
          transactionMessageBytes: new Uint8Array([
            ...getU64Encoder().encode(BigInt(10 ** 6)),
            ...getAddressEncoder().encode(ctx.wallet.address),
            ...getAddressEncoder().encode(SYSTEM_PROGRAM_ADDRESS),
          ]),
        },
        secp256r1Keys.privateKey,
        secp256r1Keys.publicKey,
        ctx
      );

      const nativeTransfer = await nativeTransferIntent({
        index: ctx.index,
        payer: ctx.payer,
        signers: [signedSigner],
        destination: ctx.wallet.address,
        amount: 10 ** 6,
        compressed: ctx.compressed,
      });

      await sendTransaction(nativeTransfer, ctx.payer, ctx.addressLookUpTable);

      const data = await getSolanaRpc()
        .getAccountInfo(ctx.multiWalletVault)
        .send();

      expect(Number(data.value?.lamports)).to.equal(
        10 ** 8 - 10 ** 6,
        "Incorrect sol balance"
      );

      let shouldFail = false;
      try {
        const nativeTransfer = await nativeTransferIntent({
          index: ctx.index,
          payer: ctx.payer,
          signers: [signedSigner],
          destination: ctx.wallet.address,
          amount: 10 ** 6,
          compressed: ctx.compressed,
        });

        await sendTransaction(
          nativeTransfer,
          ctx.payer,
          ctx.addressLookUpTable
        );
      } catch (error) {
        shouldFail = true;
      }

      expect(shouldFail).to.equal(
        true,
        "Should fail when submitting same intent twice"
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("should transfer sol with secp256r1 signer", async () => {
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
    await fundMultiWalletVault(ctx, BigInt(10 ** 8));
    //create transaction manger
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

    // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
    const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
    const createDomainUserAccountIx = await createDomainUserAccounts({
      payer: ctx.payer,
      authority: ctx.wallet,
      domainConfig: ctx.domainConfig,
      createUserArgs: {
        member: secp256r1Key,
        role: UserRole.PermanentMember,
        index: ctx.index,
        transactionManager: {
          member: transactionManager.address,
        },
      },
    });

    await sendTransaction(
      [createDomainUserAccountIx],
      ctx.payer,
      ctx.addressLookUpTable
    );

    try {
      const signedSigner = await mockAuthenticationResponse(
        {
          transactionActionType: "transfer_intent",
          transactionAddress: SYSTEM_PROGRAM_ADDRESS.toString(),
          transactionMessageBytes: new Uint8Array([
            ...getU64Encoder().encode(BigInt(10 ** 6)),
            ...getAddressEncoder().encode(ctx.wallet.address),
            ...getAddressEncoder().encode(SYSTEM_PROGRAM_ADDRESS),
          ]),
        },
        secp256r1Keys.privateKey,
        secp256r1Keys.publicKey,
        ctx
      );

      const nativeTransfer = await nativeTransferIntent({
        index: ctx.index,
        payer: ctx.payer,
        signers: [signedSigner, transactionManager],
        destination: ctx.wallet.address,
        amount: 10 ** 6,
        compressed: ctx.compressed,
      });

      await sendTransaction(
        [...nativeTransfer],
        ctx.payer,
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
