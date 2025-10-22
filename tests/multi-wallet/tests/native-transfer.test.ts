import {
  createDomainUserAccounts,
  createUserAccounts,
  getSolanaRpc,
  nativeTransferIntent,
  Secp256r1Key,
} from "@revibase/wallet";
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
  setupTestEnvironment,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runNativeTransferTest() {
  describe("Native Transfer Test", () => {
    let ctx: TestContext;

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment();
      ctx = await createMultiWallet(ctx);
    });

    it("should transfer sol", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      await fundMultiWalletVault(ctx, BigInt(10 ** 8));
      try {
        const nativeTransfer = await nativeTransferIntent({
          index: ctx.index,
          payer: ctx.payer,
          signers: [ctx.wallet],
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

    it("should transfer sol with secp256r1 signer", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;

      //create transaction manger
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

      // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
      const createDomainUserAccountIx = await createDomainUserAccounts({
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
        [createDomainUserAccountIx],
        ctx.payer,
        ctx.addressLookUpTable
      );

      try {
        const mockResult = await mockAuthenticationResponse(
          getSolanaRpc(),
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
          ctx
        );
        const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey, {
          ...mockResult,
        });
        const nativeTransfer = await nativeTransferIntent({
          index: ctx.index,
          payer: ctx.payer,
          signers: [secp256r1Key, transactionManager],
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
          10 ** 8 - 2 * 10 ** 6,
          "Incorrect sol balance"
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });
}
