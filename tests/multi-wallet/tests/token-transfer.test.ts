import {
  createDomainUserAccounts,
  createUserAccounts,
  editUserDelegate,
  getSolanaRpc,
  Secp256r1Key,
  tokenTransferIntent,
  UserRole,
} from "@revibase/core";
import { expect } from "chai";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getU64Encoder,
} from "gill";
import {
  fetchToken,
  getAssociatedTokenAccountAddress,
  getCreateAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMintInstruction,
  getMintSize,
  getMintToCheckedInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "gill/programs";
import {
  createMultiWallet,
  fundMultiWalletVault,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

export function runTokenTransferTest(getCtx: () => TestContext) {
  it("should transfer token", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    const mint = await createMint(ctx);
    if (
      !ctx.index ||
      !ctx.multiWalletVault ||
      !ctx.wallet ||
      !ctx.payer ||
      !mint
    )
      return;
    try {
      await addPayerAsNewMember(ctx);
      const instructions = await editUserDelegate({
        payer: ctx.payer,
        user: ctx.payer,
        newDelegate: { index: BigInt(ctx.index), settingsAddressTreeIndex: 0 },
      });
      await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);
      const ata = await getAssociatedTokenAccountAddress(
        mint.address,
        ctx.multiWalletVault,
        TOKEN_2022_PROGRAM_ADDRESS
      );
      const tokenTransfer = await tokenTransferIntent({
        index: ctx.index,
        payer: ctx.payer,
        signers: [ctx.payer],
        destination: ctx.wallet.address,
        amount: 10 ** 5,
        compressed: ctx.compressed,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      await sendTransaction(
        [...tokenTransfer],
        ctx.payer,
        ctx.addressLookUpTable
      );

      const data = await fetchToken(getSolanaRpc(), ata);
      expect(Number(data.data.amount)).to.equal(
        10 ** 9 - 10 ** 5,
        "Incorrect token balance"
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("should transfer token with secp256r1 signer", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    const mint = await createMint(ctx);
    if (
      !ctx.index ||
      !ctx.multiWalletVault ||
      !ctx.wallet ||
      !ctx.payer ||
      !mint ||
      !ctx.domainConfig
    )
      return;

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

    await fundMultiWalletVault(ctx, BigInt(10 ** 8));

    try {
      const signedSigner = await mockAuthenticationResponse(
        {
          transactionActionType: "transfer_intent",
          transactionAddress: TOKEN_2022_PROGRAM_ADDRESS.toString(),
          transactionMessageBytes: new Uint8Array([
            ...getU64Encoder().encode(BigInt(10 ** 5)),
            ...getAddressEncoder().encode(ctx.wallet.address),
            ...getAddressEncoder().encode(mint.address),
          ]),
        },
        secp256r1Keys.privateKey,
        secp256r1Keys.publicKey,
        ctx
      );

      const tokenTransfer = await tokenTransferIntent({
        index: ctx.index,
        payer: ctx.payer,
        signers: [signedSigner, transactionManager],
        destination: ctx.wallet.address,
        amount: 10 ** 5,
        compressed: ctx.compressed,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      await sendTransaction(
        [...tokenTransfer],
        ctx.payer,
        ctx.addressLookUpTable
      );
      const ata = await getAssociatedTokenAccountAddress(
        mint.address,
        ctx.multiWalletVault,
        TOKEN_2022_PROGRAM_ADDRESS
      );
      const data = await fetchToken(getSolanaRpc(), ata);
      expect(Number(data.data.amount)).to.equal(
        10 ** 9 - 10 ** 5,
        "Incorrect token balance"
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
}

const createMint = async (ctx: TestContext) => {
  if (!ctx.index || !ctx.multiWalletVault || !ctx.wallet || !ctx.payer) return;
  await fundMultiWalletVault(ctx, BigInt(10 ** 8));
  // Create ephemeral keypair
  const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
    crypto.getRandomValues(new Uint8Array(32))
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
    decimals: 5,
    mintAuthority: ctx.payer.address,
  });
  const ata = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.multiWalletVault,
    TOKEN_2022_PROGRAM_ADDRESS
  );
  const ataIx = getCreateAssociatedTokenIdempotentInstruction({
    ata,
    mint: ephemeralKeypair.address,
    owner: ctx.multiWalletVault,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  const mintTo = getMintToCheckedInstruction({
    amount: 10 ** 9,
    decimals: 5,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.payer,
    token: ata,
  });
  await sendTransaction(
    [createAccount, createMint, ataIx, mintTo],
    ctx.payer,
    ctx.addressLookUpTable
  );

  return ephemeralKeypair;
};
