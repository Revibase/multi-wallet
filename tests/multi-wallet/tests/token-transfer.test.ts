import {
  bufferToBase64URLString,
  createDomainUserAccounts,
  createUserAccounts,
  editUserDelegate,
  getSettingsFromIndex,
  getSolanaRpc,
  getUserAddress,
  nativeTransferIntent,
  Secp256r1Key,
  tokenTransferIntent,
  Transports,
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getU64Encoder,
} from "gill";
import {
  getAssociatedTokenAccountAddress,
  getCreateAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMintInstruction,
  getMintSize,
  getMintToCheckedInstruction,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "gill/programs";
import {
  TEST_AMOUNT_LARGE,
  TEST_AMOUNT_MEDIUM,
  TEST_AMOUNT_SMALL,
  TEST_MINT_DECIMALS,
} from "../constants.ts";
import {
  assertTestContext,
  createMultiWallet,
  expectFailure,
  fundMultiWalletVault,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
  withErrorHandling,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runTokenTransferTest(getCtx: () => TestContext) {
  it("should add payer as new member and successfully transfer mint", async () => {
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
          newDelegate: Number(ctx.index),
        });
        await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);

        const mint = await createMintAndMintToSplAccount(ctx);

        const tokenTransfer = await tokenTransferIntent({
          settings: await getSettingsFromIndex(ctx.index),
          signers: [ctx.payer],
          destination: ctx.wallet.address,
          amount: TEST_AMOUNT_SMALL,
          payer: ctx.payer,
          mint,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        await sendTransaction(
          [...tokenTransfer],
          ctx.payer,
          ctx.addressLookUpTable,
        );

        const data = await getSolanaRpc()
          .getAccountInfo(ctx.multiWalletVault)
          .send();

        const expectedBalance = TEST_AMOUNT_MEDIUM - TEST_AMOUNT_SMALL;
        expect(
          Number(data.value?.lamports),
          "Wallet vault should have correct SOL balance after transfer",
        ).to.equal(expectedBalance);
      },
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
      const credentialId = bufferToBase64URLString(
        crypto.getRandomValues(new Uint8Array(64)),
      );
      // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
      const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
      const createDomainUserAccountIx = await createDomainUserAccounts({
        payer: ctx.payer,
        authority: ctx.wallet,
        domainConfig: ctx.domainConfig!,
        createUserArgs: {
          member: secp256r1Key,
          role: UserRole.Member,
          settings: await getSettingsFromIndex(ctx.index),
          credentialId,
          transports: [Transports.Internal, Transports.Hybrid],
        },
      });

      await sendTransaction(
        [createDomainUserAccountIx],
        ctx.payer,
        ctx.addressLookUpTable,
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
        ctx,
      );

      const mint = await createMintAndMintToSplAccount(ctx);

      const tokenTransfer = await tokenTransferIntent({
        settings: await getSettingsFromIndex(ctx.index),
        signers: [ctx.payer],
        destination: ctx.wallet.address,
        amount: TEST_AMOUNT_SMALL,
        payer: ctx.payer,
        mint,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });
      await sendTransaction(tokenTransfer, ctx.payer, ctx.addressLookUpTable);

      const data = await getSolanaRpc()
        .getAccountInfo(ctx.multiWalletVault)
        .send();

      const expectedBalance = TEST_AMOUNT_MEDIUM - TEST_AMOUNT_SMALL;
      expect(
        Number(data.value?.lamports),
        "Wallet vault should have correct balance after first transfer",
      ).to.equal(expectedBalance);

      // Attempt to submit the same intent again - should fail
      await expectFailure(async () => {
        const duplicateTransfer = await nativeTransferIntent({
          settings: await getSettingsFromIndex(ctx.index),
          signers: [signedSigner],
          destination: ctx.wallet.address,
          amount: TEST_AMOUNT_SMALL,
        });

        await sendTransaction(
          duplicateTransfer,
          ctx.payer,
          ctx.addressLookUpTable,
        );
      });
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
          crypto.getRandomValues(new Uint8Array(32)),
        );
        const createUserAccountIx = await createUserAccounts({
          payer: ctx.payer,
          createUserArgs: {
            member: transactionManager,
            role: UserRole.TransactionManager,
            transactionManagerUrl: "https://xyz.com",
          },
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
        // Create Secp256r1Key and add member to an existing wallet owned by the authority together with a transaction manager
        const secp256r1Key = new Secp256r1Key(secp256r1Keys.publicKey);
        const createDomainUserAccountIx = await createDomainUserAccounts({
          payer: ctx.payer,
          authority: ctx.wallet,
          domainConfig: ctx.domainConfig!,
          createUserArgs: {
            member: secp256r1Key,
            role: UserRole.PermanentMember,
            settings: await getSettingsFromIndex(ctx.index),
            transactionManagerAccount: await getUserAddress(
              transactionManager.address,
            ),
            credentialId,
            transports: [Transports.Internal, Transports.Hybrid],
          },
        });

        await sendTransaction(
          [createDomainUserAccountIx],
          ctx.payer,
          ctx.addressLookUpTable,
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
          ctx,
        );

        const mint = await createMintAndMintToSplAccount(ctx);

        const tokenTransfer = await tokenTransferIntent({
          settings: await getSettingsFromIndex(ctx.index),
          signers: [ctx.payer],
          destination: ctx.wallet.address,
          amount: TEST_AMOUNT_SMALL,
          payer: ctx.payer,
          mint,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        await sendTransaction(
          [...tokenTransfer],
          ctx.payer,
          ctx.addressLookUpTable,
        );

        const data = await getSolanaRpc()
          .getAccountInfo(ctx.multiWalletVault)
          .send();

        const expectedBalance = TEST_AMOUNT_MEDIUM - TEST_AMOUNT_SMALL;
        expect(
          Number(data.value?.lamports),
          "Wallet vault should have correct SOL balance after Secp256r1 transfer",
        ).to.equal(expectedBalance);
      },
    );
  });
}

const createMintAndMintToSplAccount = async (ctx: TestContext) => {
  assertTestContext(ctx, ["index", "multiWalletVault", "wallet", "payer"]);
  await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));
  // Create ephemeral keypair
  const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
    crypto.getRandomValues(new Uint8Array(32)),
  );

  // Create account instruction
  const createAccount = getCreateAccountInstruction({
    payer: ctx.payer,
    newAccount: ephemeralKeypair,
    space: getMintSize(),
    lamports: await getSolanaRpc()
      .getMinimumBalanceForRentExemption(BigInt(getMintSize()))
      .send(),
    programAddress: TOKEN_2022_PROGRAM_ADDRESS,
  });

  // Create mint instruction
  const createMint = getInitializeMintInstruction({
    mint: ephemeralKeypair.address,
    decimals: TEST_MINT_DECIMALS,
    mintAuthority: ctx.payer.address,
  });
  const ata = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.multiWalletVault,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const ataIx = getCreateAssociatedTokenIdempotentInstruction({
    ata,
    mint: ephemeralKeypair.address,
    owner: ctx.multiWalletVault,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const mintTo = getMintToCheckedInstruction({
    amount: TEST_AMOUNT_LARGE,
    decimals: TEST_MINT_DECIMALS,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.payer,
    token: ata,
  });
  await sendTransaction(
    [createAccount, createMint, ataIx, mintTo],
    ctx.payer,
    ctx.addressLookUpTable,
  );

  return ephemeralKeypair.address;
};
