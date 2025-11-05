import {
  createDomainUserAccounts,
  createUserAccounts,
  getSolanaRpc,
  Secp256r1Key,
  tokenTransferIntent,
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
import type { TestContext } from "../types.ts";

export function runTokenTransferTest(getCtx: () => TestContext) {
  it("should transfer token", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    const mint = await createMint(ctx);
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault || !mint) return;
    try {
      const ata = await getAssociatedTokenAccountAddress(
        mint.address,
        ctx.multiWalletVault,
        TOKEN_2022_PROGRAM_ADDRESS
      );
      const tokenTransfer = await tokenTransferIntent({
        settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
        payer: ctx.payer.member,
        signers: [ctx.wallet.member],
        destination: ctx.wallet.member.address,
        amount: 10 ** 5,
        compressed: ctx.compressed,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      await sendTransaction(
        [...tokenTransfer],
        ctx.payer.member,
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
    if (!ctx.settingsIndexWithAddress || !ctx.multiWalletVault || !mint) return;

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

    await fundMultiWalletVault(ctx, BigInt(10 ** 8));

    try {
      const signedSigner = await mockAuthenticationResponse(
        getSolanaRpc(),
        {
          transactionActionType: "transfer_intent",
          transactionAddress: TOKEN_2022_PROGRAM_ADDRESS.toString(),
          transactionMessageBytes: new Uint8Array([
            ...getU64Encoder().encode(BigInt(10 ** 5)),
            ...getAddressEncoder().encode(ctx.wallet.member.address),
            ...getAddressEncoder().encode(mint.address),
          ]),
        },
        secp256r1Keys.privateKey,
        secp256r1Keys.publicKey,
        secp256r1AddressTree,
        ctx
      );

      const tokenTransfer = await tokenTransferIntent({
        settingsIndexWithAddressArgs: ctx.settingsIndexWithAddress,
        payer: ctx.payer.member,
        signers: [signedSigner, transactionManager],
        destination: ctx.wallet.member.address,
        amount: 10 ** 5,
        compressed: ctx.compressed,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      await sendTransaction(
        [...tokenTransfer],
        ctx.payer.member,
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
  if (!ctx.multiWalletVault || !ctx.settingsIndexWithAddress) return;
  await fundMultiWalletVault(ctx, BigInt(10 ** 8));
  // Create ephemeral keypair
  const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
    crypto.getRandomValues(new Uint8Array(32))
  );

  // Create account instruction
  const createAccount = getCreateAccountInstruction({
    payer: ctx.payer.member,
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
    mintAuthority: ctx.payer.member.address,
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
    payer: ctx.payer.member,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  const mintTo = getMintToCheckedInstruction({
    amount: 10 ** 9,
    decimals: 5,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.payer.member,
    token: ata,
  });
  await sendTransaction(
    [createAccount, createMint, ataIx, mintTo],
    ctx.payer.member,
    ctx.addressLookUpTable
  );

  return ephemeralKeypair;
};
