import {
  createAtaInterfaceIdempotent,
  createSplInterface,
  getAssociatedTokenAddressInterface,
  wrap,
} from "@lightprotocol/compressed-token";
import {
  compress,
  getAtaInterface,
  transferInterface,
} from "@lightprotocol/compressed-token/unified";
import {
  createDomainUserAccounts,
  createUserAccounts,
  editUserDelegate,
  getLightProtocolRpc,
  getSolanaRpc,
  Secp256r1Key,
  tokenTransferIntent,
  UserRole,
} from "@revibase/core";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getU64Encoder,
  some,
  type Address,
} from "gill";
import {
  extension,
  fetchToken,
  getAssociatedTokenAccountAddress,
  getCreateAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMetadataPointerInstruction,
  getInitializeMintInstruction,
  getInitializeTokenMetadataInstruction,
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

type SourceKind =
  | "spl"
  | "ctoken"
  | "compressed"
  | "spl&compressed"
  | "ctoken+compressed"
  | "spl+ctoken"
  | "spl+ctoken+compressed";

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
  {
    name: "when source ata is ctoken and destination ata exist",
    source: "ctoken",
    destinationAtaExists: true,
  },
  {
    name: "when source ata is ctoken and destination ata does not exist",
    source: "ctoken",
    destinationAtaExists: false,
  },
  {
    name: "when source ata is compressed token and destination ata exist",
    source: "compressed",
    destinationAtaExists: true,
  },
  {
    name: "when source ata is compressed token and destination ata does not exist",
    source: "compressed",
    destinationAtaExists: false,
  },
  {
    name: "when source ata is spl & compressed token and destination ata exist",
    source: "spl&compressed",
    destinationAtaExists: true,
  },
  {
    name: "when source ata is spl & compressed token and destination ata does not exist",
    source: "spl&compressed",
    destinationAtaExists: false,
  },
  {
    name: "when source ata is spl & ctoken and destination ata exist",
    source: "spl+ctoken",
    destinationAtaExists: true,
  },
  {
    name: "when source ata is spl & ctoken and destination ata does not exist",
    source: "spl+ctoken",
    destinationAtaExists: false,
  },
  {
    name: "when source ata is ctoken & compressed token and destination ata exist",
    source: "ctoken+compressed",
    destinationAtaExists: true,
  },
  {
    name: "when source ata is ctoken & compressed token and destination ata does not exist",
    source: "ctoken+compressed",
    destinationAtaExists: false,
  },
  {
    name: "when source ata is spl & ctoken & compressed token and destination ata exist",
    source: "spl+ctoken+compressed",
    destinationAtaExists: true,
  },
  {
    name: "when source ata is spl & ctoken & compressed token and destination ata does not exist",
    source: "spl+ctoken+compressed",
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
  it("when source ata is spl & ctoken & compressed token and destination ata does not exist with secp256r1 signer", async () => {
    await withErrorHandling(
      "token transfer with Secp256r1 signer",
      async () => {
        let ctx = getCtx();
        ctx = await createMultiWallet(ctx);
        const mint =
          await createMintAndMintToSplAndCTokenAndCompressedAccount(ctx);
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
          index: ctx.index,
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

const createMintAndMintToCTokenAccount = async (ctx: TestContext) => {
  if (
    !ctx.index ||
    !ctx.multiWalletVault ||
    !ctx.wallet ||
    !ctx.payer ||
    !ctx.newMember ||
    !ctx.newMemberSecretKey
  )
    return;
  await fundMultiWalletVault(ctx, BigInt(10 ** 8));
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
    decimals: 5,
    mintAuthority: ctx.newMember.address,
  });
  const senderAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const senderCTokenAta = getAssociatedTokenAddressInterface(
    new PublicKey(ephemeralKeypair.address),
    new PublicKey(ctx.newMember.address),
  );
  const ataIx = getCreateAssociatedTokenIdempotentInstruction({
    ata: senderAta,
    mint: ephemeralKeypair.address,
    owner: ctx.newMember.address,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const mintTo = getMintToCheckedInstruction({
    amount: 10 ** 9,
    decimals: 5,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.newMember,
    token: senderAta,
  });
  await sendTransaction(
    [createAccount, createMint, ataIx, mintTo],
    ctx.payer,
    ctx.addressLookUpTable,
  );

  const mint = new PublicKey(ephemeralKeypair.address.toString());
  const payer = {
    publicKey: new PublicKey(ctx.payer.address.toString()),
    secretKey: ctx.payerSecretKey,
  };
  const newMember = {
    publicKey: new PublicKey(ctx.newMember.address.toString()),
    secretKey: ctx.newMemberSecretKey,
  };

  const recipientAta = getAssociatedTokenAddressInterface(
    mint,
    new PublicKey(ctx.multiWalletVault),
    true,
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.multiWalletVault),
    true,
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.newMember.address),
  );

  await createSplInterface(getLightProtocolRpc(), payer, mint);

  await wrap(
    getLightProtocolRpc(),
    payer,
    new PublicKey(senderAta),
    senderCTokenAta,
    newMember,
    mint,
    BigInt(10 ** 9),
  );

  await transferInterface(
    getLightProtocolRpc(),
    payer,
    senderCTokenAta,
    mint,
    recipientAta,
    newMember,
    10 ** 9,
  );

  return address(mint.toString());
};

const createMintAndMintToCompressedAccount = async (ctx: TestContext) => {
  if (
    !ctx.index ||
    !ctx.multiWalletVault ||
    !ctx.wallet ||
    !ctx.payer ||
    !ctx.newMember ||
    !ctx.newMemberSecretKey
  )
    return;
  await fundMultiWalletVault(ctx, BigInt(10 ** 8));
  // Create ephemeral keypair
  const ephemeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
    crypto.getRandomValues(new Uint8Array(32)),
  );

  const metadataExtension = extension("TokenMetadata", {
    updateAuthority: some(ctx.newMember.address),
    mint: ephemeralKeypair.address,
    name: "OPOS",
    symbol: "OPS",
    uri: "https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json",
    additionalMetadata: new Map().set("description", "Only possible on Solana"),
  });

  const metadataPointerExtension = extension("MetadataPointer", {
    authority: ctx.newMember.address,
    metadataAddress: ephemeralKeypair.address, // can also point to another account if desired
  });
  const spaceWithoutTokenMetadataExtension = BigInt(
    getMintSize([metadataPointerExtension]),
  );
  const spaceWithTokenMetadataExtension = BigInt(
    getMintSize([metadataPointerExtension, metadataExtension]),
  );
  const rent = await getSolanaRpc()
    .getMinimumBalanceForRentExemption(spaceWithTokenMetadataExtension)
    .send();

  // Create account instruction
  const createMintAccountInstruction = getCreateAccountInstruction({
    payer: ctx.payer,
    newAccount: ephemeralKeypair,
    space: spaceWithoutTokenMetadataExtension,
    lamports: rent,
    programAddress: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const initializeMetadataInstruction = getInitializeTokenMetadataInstruction({
    metadata: ephemeralKeypair.address, // Account address that holds the metadata
    updateAuthority: ctx.newMember.address, // Authority that can update the metadata
    mint: ephemeralKeypair.address, // Mint Account address
    mintAuthority: ctx.newMember, // Designated Mint Authority
    name: "OPOS",
    symbol: "OPS",
    uri: "https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json",
  });

  const initializeMetadataPointerInstruction =
    getInitializeMetadataPointerInstruction({
      mint: ephemeralKeypair.address,
      authority: ctx.newMember.address,
      metadataAddress: ephemeralKeypair.address,
    });

  // Create mint instruction
  const initializeMintInstruction = getInitializeMintInstruction({
    mint: ephemeralKeypair.address,
    decimals: 5,
    mintAuthority: ctx.newMember.address,
  });

  const newMemberSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const ataIx = getCreateAssociatedTokenIdempotentInstruction({
    ata: newMemberSplAta,
    mint: ephemeralKeypair.address,
    owner: ctx.newMember.address,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const mintTo = getMintToCheckedInstruction({
    amount: 10 ** 9,
    decimals: 5,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.newMember,
    token: newMemberSplAta,
  });
  await sendTransaction(
    [
      createMintAccountInstruction,
      initializeMetadataPointerInstruction,
      initializeMintInstruction,
      initializeMetadataInstruction,
      ataIx,
      mintTo,
    ],
    ctx.payer,
    ctx.addressLookUpTable,
  );

  const mint = new PublicKey(ephemeralKeypair.address.toString());
  const payer = {
    publicKey: new PublicKey(ctx.payer.address.toString()),
    secretKey: ctx.payerSecretKey,
  };
  const newMember = {
    publicKey: new PublicKey(ctx.newMember.address.toString()),
    secretKey: ctx.newMemberSecretKey,
  };

  await createSplInterface(getLightProtocolRpc(), payer, mint);

  await compress(
    getLightProtocolRpc(),
    payer,
    mint,
    10 ** 9,
    newMember,
    new PublicKey(newMemberSplAta),
    new PublicKey(ctx.multiWalletVault),
  );

  return address(mint.toString());
};

const createMintAndMintToSplAndCompressedTokenAccount = async (
  ctx: TestContext,
) => {
  if (
    !ctx.index ||
    !ctx.multiWalletVault ||
    !ctx.wallet ||
    !ctx.payer ||
    !ctx.newMember ||
    !ctx.newMemberSecretKey
  )
    return;
  await fundMultiWalletVault(ctx, BigInt(10 ** 8));
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
    decimals: 5,
    mintAuthority: ctx.newMember.address,
  });
  const newMemberSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS,
  );

  const ataIx = getCreateAssociatedTokenIdempotentInstruction({
    ata: newMemberSplAta,
    mint: ephemeralKeypair.address,
    owner: ctx.newMember.address,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const mintTo = getMintToCheckedInstruction({
    amount: 10 ** 9,
    decimals: 5,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.newMember,
    token: newMemberSplAta,
  });
  await sendTransaction(
    [createAccount, createMint, ataIx, mintTo],
    ctx.payer,
    ctx.addressLookUpTable,
  );

  const mint = new PublicKey(ephemeralKeypair.address.toString());
  const payer = {
    publicKey: new PublicKey(ctx.payer.address.toString()),
    secretKey: ctx.payerSecretKey,
  };
  const newMember = {
    publicKey: new PublicKey(ctx.newMember.address.toString()),
    secretKey: ctx.newMemberSecretKey,
  };

  const recipientSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.multiWalletVault,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const ataIx2 = getCreateAssociatedTokenIdempotentInstruction({
    ata: recipientSplAta,
    mint: ephemeralKeypair.address,
    owner: ctx.multiWalletVault,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  await sendTransaction([ataIx2], ctx.payer);

  await createSplInterface(getLightProtocolRpc(), payer, mint);

  //transfer half to multiwalletSplToken
  await transferInterface(
    getLightProtocolRpc(),
    payer,
    new PublicKey(newMemberSplAta),
    mint,
    new PublicKey(recipientSplAta),
    newMember,
    10 ** 9 / 2,
    new PublicKey(TOKEN_2022_PROGRAM_ADDRESS),
  );

  // transfer half to multiWallet compressed token
  await compress(
    getLightProtocolRpc(),
    payer,
    mint,
    10 ** 9 / 2,
    newMember,
    new PublicKey(newMemberSplAta),
    new PublicKey(ctx.multiWalletVault),
  );

  return address(mint.toString());
};

const createMintAndMintToSplAndCTokenAccount = async (ctx: TestContext) => {
  if (
    !ctx.index ||
    !ctx.multiWalletVault ||
    !ctx.wallet ||
    !ctx.payer ||
    !ctx.newMember ||
    !ctx.newMemberSecretKey
  )
    return;
  await fundMultiWalletVault(ctx, BigInt(10 ** 8));
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
    decimals: 5,
    mintAuthority: ctx.newMember.address,
  });
  const newMemberSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const senderCTokenAta = getAssociatedTokenAddressInterface(
    new PublicKey(ephemeralKeypair.address),
    new PublicKey(ctx.newMember.address),
  );
  const ataIx = getCreateAssociatedTokenIdempotentInstruction({
    ata: newMemberSplAta,
    mint: ephemeralKeypair.address,
    owner: ctx.newMember.address,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const mintTo = getMintToCheckedInstruction({
    amount: 10 ** 9,
    decimals: 5,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.newMember,
    token: newMemberSplAta,
  });
  await sendTransaction(
    [createAccount, createMint, ataIx, mintTo],
    ctx.payer,
    ctx.addressLookUpTable,
  );

  const mint = new PublicKey(ephemeralKeypair.address.toString());
  const payer = {
    publicKey: new PublicKey(ctx.payer.address.toString()),
    secretKey: ctx.payerSecretKey,
  };
  const newMember = {
    publicKey: new PublicKey(ctx.newMember.address.toString()),
    secretKey: ctx.newMemberSecretKey,
  };

  const recipientCTokenAta = getAssociatedTokenAddressInterface(
    mint,
    new PublicKey(ctx.multiWalletVault),
    true,
  );
  const recipientSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.multiWalletVault,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const ataIx2 = getCreateAssociatedTokenIdempotentInstruction({
    ata: recipientSplAta,
    mint: ephemeralKeypair.address,
    owner: ctx.multiWalletVault,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  await sendTransaction([ataIx2], ctx.payer);

  //transfer half to multiwalletSplToken
  await transferInterface(
    getLightProtocolRpc(),
    payer,
    new PublicKey(newMemberSplAta),
    mint,
    new PublicKey(recipientSplAta),
    newMember,
    10 ** 9 / 2,
    new PublicKey(TOKEN_2022_PROGRAM_ADDRESS),
  );

  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.multiWalletVault),
    true,
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.newMember.address),
  );

  await createSplInterface(getLightProtocolRpc(), payer, mint);

  // transfer remaining half to sender ctoken then send senderCtoken to multiwalletCToken
  await wrap(
    getLightProtocolRpc(),
    payer,
    new PublicKey(newMemberSplAta),
    senderCTokenAta,
    newMember,
    mint,
    BigInt(10 ** 9 / 2),
  );

  await transferInterface(
    getLightProtocolRpc(),
    payer,
    senderCTokenAta,
    mint,
    recipientCTokenAta,
    newMember,
    10 ** 9 / 2,
  );

  return address(mint.toString());
};

const createMintAndMintToCTokenAndCompressedAccount = async (
  ctx: TestContext,
) => {
  if (
    !ctx.index ||
    !ctx.multiWalletVault ||
    !ctx.wallet ||
    !ctx.payer ||
    !ctx.newMember ||
    !ctx.newMemberSecretKey
  )
    return;
  await fundMultiWalletVault(ctx, BigInt(10 ** 8));
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
    decimals: 5,
    mintAuthority: ctx.newMember.address,
  });
  const newMemberSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const senderCTokenAta = getAssociatedTokenAddressInterface(
    new PublicKey(ephemeralKeypair.address),
    new PublicKey(ctx.newMember.address),
  );
  const ataIx = getCreateAssociatedTokenIdempotentInstruction({
    ata: newMemberSplAta,
    mint: ephemeralKeypair.address,
    owner: ctx.newMember.address,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const mintTo = getMintToCheckedInstruction({
    amount: 10 ** 9,
    decimals: 5,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.newMember,
    token: newMemberSplAta,
  });
  await sendTransaction(
    [createAccount, createMint, ataIx, mintTo],
    ctx.payer,
    ctx.addressLookUpTable,
  );

  const mint = new PublicKey(ephemeralKeypair.address.toString());
  const payer = {
    publicKey: new PublicKey(ctx.payer.address.toString()),
    secretKey: ctx.payerSecretKey,
  };
  const newMember = {
    publicKey: new PublicKey(ctx.newMember.address.toString()),
    secretKey: ctx.newMemberSecretKey,
  };

  const recipientCTokenAta = getAssociatedTokenAddressInterface(
    mint,
    new PublicKey(ctx.multiWalletVault),
    true,
  );

  await createSplInterface(getLightProtocolRpc(), payer, mint);

  //transfer half to multiwalletCompressedToken
  await compress(
    getLightProtocolRpc(),
    payer,
    mint,
    10 ** 9 / 2,
    newMember,
    new PublicKey(newMemberSplAta),
    new PublicKey(ctx.multiWalletVault),
  );

  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.multiWalletVault),
    true,
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.newMember.address),
  );

  // transfer remaining to sender ctoken then send to multiwalletCToken
  await wrap(
    getLightProtocolRpc(),
    payer,
    new PublicKey(newMemberSplAta),
    senderCTokenAta,
    newMember,
    mint,
    BigInt(10 ** 9 / 2),
  );

  await transferInterface(
    getLightProtocolRpc(),
    payer,
    senderCTokenAta,
    mint,
    recipientCTokenAta,
    newMember,
    10 ** 9 / 2,
  );

  return address(mint.toString());
};

const createMintAndMintToSplAndCTokenAndCompressedAccount = async (
  ctx: TestContext,
) => {
  if (
    !ctx.index ||
    !ctx.multiWalletVault ||
    !ctx.wallet ||
    !ctx.payer ||
    !ctx.newMember ||
    !ctx.newMemberSecretKey
  )
    return;
  await fundMultiWalletVault(ctx, BigInt(10 ** 8));
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
    decimals: 5,
    mintAuthority: ctx.newMember.address,
  });
  const newMemberSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const senderCTokenAta = getAssociatedTokenAddressInterface(
    new PublicKey(ephemeralKeypair.address),
    new PublicKey(ctx.newMember.address),
  );
  const ataIx = getCreateAssociatedTokenIdempotentInstruction({
    ata: newMemberSplAta,
    mint: ephemeralKeypair.address,
    owner: ctx.newMember.address,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const mintTo = getMintToCheckedInstruction({
    amount: 10 ** 9,
    decimals: 5,
    mint: ephemeralKeypair.address,
    mintAuthority: ctx.newMember,
    token: newMemberSplAta,
  });
  await sendTransaction(
    [createAccount, createMint, ataIx, mintTo],
    ctx.payer,
    ctx.addressLookUpTable,
  );

  const mint = new PublicKey(ephemeralKeypair.address.toString());
  const payer = {
    publicKey: new PublicKey(ctx.payer.address.toString()),
    secretKey: ctx.payerSecretKey,
  };
  const newMember = {
    publicKey: new PublicKey(ctx.newMember.address.toString()),
    secretKey: ctx.newMemberSecretKey,
  };

  const recipientCTokenAta = getAssociatedTokenAddressInterface(
    mint,
    new PublicKey(ctx.multiWalletVault),
    true,
  );
  const recipientSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.multiWalletVault,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const ataIx2 = getCreateAssociatedTokenIdempotentInstruction({
    ata: recipientSplAta,
    mint: ephemeralKeypair.address,
    owner: ctx.multiWalletVault,
    payer: ctx.payer,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  await sendTransaction([ataIx2], ctx.payer);

  //transfer one third to multiwalletSplToken
  await transferInterface(
    getLightProtocolRpc(),
    payer,
    new PublicKey(newMemberSplAta),
    mint,
    new PublicKey(recipientSplAta),
    newMember,
    Math.floor(10 ** 9 / 3),
    new PublicKey(TOKEN_2022_PROGRAM_ADDRESS),
  );

  await createSplInterface(getLightProtocolRpc(), payer, mint);

  //transfer one third to multiwalletCompressedToken
  await compress(
    getLightProtocolRpc(),
    payer,
    mint,
    Math.floor(10 ** 9 / 3),
    newMember,
    new PublicKey(newMemberSplAta),
    new PublicKey(ctx.multiWalletVault),
  );

  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.multiWalletVault),
    true,
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.newMember.address),
  );

  // transfer remaining to sender ctoken then send to multiwalletCToken
  const remaining = 10 ** 9 - 2 * Math.floor(10 ** 9 / 3);
  await wrap(
    getLightProtocolRpc(),
    payer,
    new PublicKey(newMemberSplAta),
    senderCTokenAta,
    newMember,
    mint,
    BigInt(remaining),
  );

  await transferInterface(
    getLightProtocolRpc(),
    payer,
    senderCTokenAta,
    mint,
    recipientCTokenAta,
    newMember,
    Math.floor(remaining),
  );

  return address(mint.toString());
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
    case "ctoken":
      return createMintAndMintToCTokenAccount(ctx);
    case "compressed":
      return createMintAndMintToCompressedAccount(ctx);
    case "spl&compressed":
      return createMintAndMintToSplAndCompressedTokenAccount(ctx);
    case "ctoken+compressed":
      return createMintAndMintToCTokenAndCompressedAccount(ctx);
    case "spl+ctoken":
      return createMintAndMintToSplAndCTokenAccount(ctx);
    case "spl+ctoken+compressed":
      return createMintAndMintToSplAndCTokenAndCompressedAccount(ctx);
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
    index: ctx.index,
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
