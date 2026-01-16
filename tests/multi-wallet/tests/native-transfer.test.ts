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
import { TEST_AMOUNT_MEDIUM, TEST_AMOUNT_SMALL } from "../constants.ts";
import {
  assertTestContext,
  createMultiWallet,
  fundMultiWalletVault,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runNativeTransferTest(getCtx: () => TestContext) {
  it("should add payer as new member and successfully transfer SOL", async () => {
    await withErrorHandling(
      "native transfer with payer as member",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "wallet",
          "payer",
        ]);

        await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));
        await addPayerAsNewMember(ctx);

        const instructions = await editUserDelegate({
          payer: ctx.payer,
          user: ctx.payer,
          newDelegate: {
            index: BigInt(ctx.index),
            settingsAddressTreeIndex: 0,
          },
        });
        await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);

        const nativeTransfer = await nativeTransferIntent({
          index: ctx.index,
          payer: ctx.payer,
          signers: [ctx.payer],
          destination: ctx.wallet.address,
          amount: TEST_AMOUNT_SMALL,
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

        const expectedBalance = TEST_AMOUNT_MEDIUM - TEST_AMOUNT_SMALL;
        expect(
          Number(data.value?.lamports),
          "Wallet vault should have correct SOL balance after transfer"
        ).to.equal(expectedBalance);
      }
    );
  });

  it("should reject duplicate transaction intents with the same signer", async () => {
    await withErrorHandling("duplicate intent rejection", async () => {
      let ctx = getCtx();
      ctx = await createMultiWallet(ctx);
      assertTestContext(ctx, [
        "index",
        "multiWalletVault",
        "wallet",
        "payer",
        "domainConfig",
      ]);

      await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));

      const secp256r1Keys = generateSecp256r1KeyPair();

      // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
      const createDomainUserAccountIx = await createDomainUserAccounts({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig!,
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

      const signedSigner = await mockAuthenticationResponse(
        {
          transactionActionType: "transfer_intent",
          transactionAddress: SYSTEM_PROGRAM_ADDRESS.toString(),
          transactionMessageBytes: new Uint8Array([
            ...getU64Encoder().encode(BigInt(TEST_AMOUNT_SMALL)),
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
        amount: TEST_AMOUNT_SMALL,
        compressed: ctx.compressed,
      });

      await sendTransaction(nativeTransfer, ctx.payer, ctx.addressLookUpTable);

      const data = await getSolanaRpc()
        .getAccountInfo(ctx.multiWalletVault)
        .send();

      const expectedBalance = TEST_AMOUNT_MEDIUM - TEST_AMOUNT_SMALL;
      expect(
        Number(data.value?.lamports),
        "Wallet vault should have correct balance after first transfer"
      ).to.equal(expectedBalance);

      // Attempt to submit the same intent again - should fail
      let duplicateIntentFailed = false;
      try {
        const duplicateTransfer = await nativeTransferIntent({
          index: ctx.index,
          payer: ctx.payer,
          signers: [signedSigner],
          destination: ctx.wallet.address,
          amount: TEST_AMOUNT_SMALL,
          compressed: ctx.compressed,
        });

        await sendTransaction(
          duplicateTransfer,
          ctx.payer,
          ctx.addressLookUpTable
        );
      } catch (error) {
        duplicateIntentFailed = true;
      }

      expect(
        duplicateIntentFailed,
        "Submitting the same intent twice should fail"
      ).to.be.true;
    });
  });

  it("should successfully transfer SOL using Secp256r1 signer with transaction manager", async () => {
    await withErrorHandling(
      "native transfer with Secp256r1 and transaction manager",
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

        await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));

        // Create transaction manager
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
          domainConfig: ctx.domainConfig!,
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

        const signedSigner = await mockAuthenticationResponse(
          {
            transactionActionType: "transfer_intent",
            transactionAddress: SYSTEM_PROGRAM_ADDRESS.toString(),
            transactionMessageBytes: new Uint8Array([
              ...getU64Encoder().encode(BigInt(TEST_AMOUNT_SMALL)),
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
          amount: TEST_AMOUNT_SMALL,
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

        const expectedBalance = TEST_AMOUNT_MEDIUM - TEST_AMOUNT_SMALL;
        expect(
          Number(data.value?.lamports),
          "Wallet vault should have correct SOL balance after Secp256r1 transfer"
        ).to.equal(expectedBalance);
      }
    );
  });
}
