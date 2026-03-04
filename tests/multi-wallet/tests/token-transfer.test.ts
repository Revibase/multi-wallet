import { getAssociatedTokenAddressInterface } from "@lightprotocol/compressed-token";
import { getAtaInterface } from "@lightprotocol/compressed-token/unified";
import {
  bufferToBase64URLString,
  createDomainUserAccounts,
  createUserAccounts,
  editUserDelegate,
  getLightProtocolRpc,
  getSettingsFromIndex,
  getSolanaRpc,
  Secp256r1Key,
  tokenTransferIntent,
  Transports,
  UserRole,
} from "@revibase/core";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getU64Encoder,
  type Address,
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
  TEST_AMOUNT_LARGE,
  TEST_AMOUNT_MEDIUM,
  TEST_MINT_DECIMALS,
  TEST_TRANSACTION_MANAGER_URL,
} from "../constants.ts";
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

type SourceKind = "spl";

type Scenario = {
  name: string;
  source: SourceKind;
  destinationAtaExists: boolean;
};

const SCENARIOS: Scenario[] = [
  {
    name: "when source ata is spl and destination ata exist",
    source: "spl",
    destinationAtaExists: true,
  },
  {
    name: "when source ata is spl and destination ata does not exist",
    source: "spl",
    destinationAtaExists: false,
  },
];

export function runTokenTransferTest(getCtx: () => TestContext) {
  for (const s of SCENARIOS) {
    it(s.name, async () => {
      await withErrorHandling(`token transfer: ${s.name}`, async () => {
        await runScenario(getCtx, s);
      });
    });
  }
  it("when source ata is spl and destination ata does not exist with secp256r1 signer", async () => {
    await withErrorHandling(
      "token transfer with Secp256r1 signer",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        const mint = await createMintAndMintToSplAccount(ctx);
        assertTestContext(ctx, [
          "index",
          "multiWalletVault",
          "wallet",
          "payer",
          "domainConfig",
        ]);

        if (!mint) {
          throw new Error("Failed to create mint for Secp256r1 test");
        }

        // Create transaction manager
        const transactionManager = await createKeyPairSignerFromPrivateKeyBytes(
          crypto.getRandomValues(new Uint8Array(32)),
        );
        const createUserAccountIx = await createUserAccounts({
          payer: ctx.payer,
          createUserArgs: [
            {
              member: transactionManager,
              role: UserRole.TransactionManager,
              transactionManagerUrl: TEST_TRANSACTION_MANAGER_URL,
            },
          ],
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
            transactionManager: {
              member: transactionManager.address,
            },
            credentialId,
            transports: [Transports.Internal, Transports.Hybrid],
          },
        });

        await sendTransaction(
          [createDomainUserAccountIx],
          ctx.payer,
          ctx.addressLookUpTable,
        );

        await fundMultiWalletVault(ctx, BigInt(TEST_AMOUNT_MEDIUM));

        const signedSigner = await mockAuthenticationResponse(
          {
            transactionActionType: "transfer_intent",
            transactionAddress: TOKEN_2022_PROGRAM_ADDRESS.toString(),
            transactionMessageBytes: new Uint8Array([
              ...getU64Encoder().encode(BigInt(TEST_AMOUNT_LARGE)),
              ...getAddressEncoder().encode(ctx.wallet.address),
              ...getAddressEncoder().encode(mint),
            ]),
          },
          secp256r1Keys.privateKey,
          secp256r1Keys.publicKey,
          ctx,
        );

        const tokenTransfer = await tokenTransferIntent({
          settings: await getSettingsFromIndex(ctx.index),
          payer: ctx.payer,
          signers: [signedSigner, transactionManager],
          destination: ctx.wallet.address,
          amount: TEST_AMOUNT_LARGE,
          compressed: ctx.compressed,
          mint,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        await sendTransaction(
          [...tokenTransfer],
          ctx.payer,
          ctx.addressLookUpTable,
        );

        const ata = getAssociatedTokenAddressInterface(
          new PublicKey(mint),
          new PublicKey(ctx.wallet.address),
        );
        const { parsed } = await getAtaInterface(
          getLightProtocolRpc(),
          new PublicKey(ata),
          new PublicKey(ctx.wallet.address),
          new PublicKey(mint),
        );

        expect(
          Number(parsed.amount),
          "Token balance should match the transferred amount",
        ).to.equal(TEST_AMOUNT_LARGE);
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

async function createDestinationAta(mint: Address, ctx: TestContext) {
  assertTestContext(ctx, ["wallet", "payer"]);
  const destinationAta = await getAssociatedTokenAccountAddress(
    mint,
    ctx.wallet.address,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const destinationAtaIx = getCreateAssociatedTokenIdempotentInstruction({
    ata: destinationAta,
    mint: mint,
    owner: ctx.wallet.address,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  await sendTransaction([destinationAtaIx], ctx.payer, ctx.addressLookUpTable);
}

async function mintForScenario(ctx: TestContext, source: SourceKind) {
  switch (source) {
    case "spl":
      return createMintAndMintToSplAccount(ctx);
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function getVaultAta(
  ctx: TestContext,
  mint: Address,
  destinationAtaExists: boolean,
) {
  if (!ctx.wallet) throw new Error("vault not found.");
  return address(
    getAssociatedTokenAddressInterface(
      new PublicKey(mint),
      new PublicKey(ctx.wallet.address),
      true,
      destinationAtaExists
        ? new PublicKey(TOKEN_2022_PROGRAM_ADDRESS)
        : undefined,
    ).toString(),
  );
}

async function fetchVaultAtaAmount(
  ctx: TestContext,
  mint: Address,
  destinationAtaExists: boolean,
) {
  if (!ctx.wallet) throw new Error("destination does not exist");
  const ata = getVaultAta(ctx, mint, destinationAtaExists);
  if (destinationAtaExists) {
    const data = await fetchToken(getSolanaRpc(), ata);
    return Number(data.data.amount);
  } else {
    const { parsed } = await getAtaInterface(
      getLightProtocolRpc(),
      new PublicKey(ata),
      new PublicKey(ctx.wallet.address),
      new PublicKey(mint),
    );
    return Number(parsed.amount);
  }
}

async function ensureDelegate(ctx: TestContext) {
  await addPayerAsNewMember(ctx);
  if (!ctx.payer || !ctx.index) return;
  const instructions = await editUserDelegate({
    payer: ctx.payer,
    user: ctx.payer,
    newDelegate: { index: BigInt(ctx.index), settingsAddressTreeIndex: 0 },
  });

  await sendTransaction(instructions, ctx.payer, ctx.addressLookUpTable);
}

async function doTokenTransfer(ctx: TestContext, mint: Address) {
  assertTestContext(ctx, ["index", "payer", "wallet"]);
  const tokenTransfer = await tokenTransferIntent({
    settings: await getSettingsFromIndex(ctx.index),
    payer: ctx.payer,
    signers: [ctx.payer],
    destination: ctx.wallet.address,
    amount: TEST_AMOUNT_LARGE,
    compressed: ctx.compressed,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  await sendTransaction([...tokenTransfer], ctx.payer, ctx.addressLookUpTable);
}

async function runScenario(getCtx: () => TestContext, s: Scenario) {
  let ctx = getCtx();
  ctx = await createMultiWallet(ctx);
  assertTestContext(ctx, ["index", "multiWalletVault", "wallet", "payer"]);

  const mint = await mintForScenario(ctx, s.source);

  if (!mint) {
    throw new Error(`Failed to create mint for scenario: ${s.name}`);
  }

  if (s.destinationAtaExists) {
    await createDestinationAta(mint, ctx);
  }

  await ensureDelegate(ctx);
  await doTokenTransfer(ctx, mint);

  const amount = await fetchVaultAtaAmount(ctx, mint, s.destinationAtaExists);
  expect(
    amount,
    `Token balance should be ${TEST_AMOUNT_LARGE} after transfer for scenario: ${s.name}`,
  ).to.equal(TEST_AMOUNT_LARGE);
}
