import { getSolanaRpc, tokenTransferIntent } from "@revibase/wallet-sdk";
import { expect } from "chai";
import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
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
  sendTransaction,
  setupTestEnvironment,
} from "../helpers/index.ts";
import type { TestContext } from "../types.ts";

export function runTokenTransferTest() {
  describe("Token Transfer Test", () => {
    let ctx: TestContext;

    // Set up a fresh context for this test suite
    before(async () => {
      ctx = await setupTestEnvironment(false);
      ctx = await createMultiWallet(ctx);
    });

    it("should transfer token", async () => {
      if (!ctx.index || !ctx.multiWalletVault) return;
      try {
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
          amount: 10 ** 5,
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

        const tokenTransfer = await tokenTransferIntent({
          index: ctx.index,
          payer: ctx.payer,
          signers: [ctx.wallet],
          destination: ctx.wallet.address,
          amount: 10 ** 5,
          compressed: ctx.compressed,
          mint: ephemeralKeypair.address,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        await sendTransaction(
          [...tokenTransfer],
          ctx.payer,
          ctx.addressLookUpTable
        );

        const data = await fetchToken(getSolanaRpc(), ata);
        expect(Number(data.data.amount)).to.equal(0, "Incorrect token balance");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });
}
