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
  createMultiWallet,
  fundMultiWalletVault,
  generateSecp256r1KeyPair,
  mockAuthenticationResponse,
  sendTransaction,
} from "../helpers/index.ts";
import { addPayerAsNewMember } from "../helpers/transaction.ts";
import type { TestContext } from "../types.ts";

type SourceKind =
  | "spl"
  | "ctoken"
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
      try {
        await runScenario(getCtx, s);
      } catch (error) {
        console.error(`[${s.name}] Test failed:`, error);
        throw error;
      }
    });
  }
  it("when source ata is spl & ctoken & compressed token and destination ata does not exist with secp256r1 signer", async () => {
    let ctx = getCtx();
    ctx = await createMultiWallet(ctx);
    const mint = await createMintAndMintToSplAndCTokenAndCompressedAccount(ctx);
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
            ...getU64Encoder().encode(BigInt(10 ** 9)),
            ...getAddressEncoder().encode(ctx.wallet.address),
            ...getAddressEncoder().encode(mint),
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
        amount: 10 ** 9,
        compressed: ctx.compressed,
        mint,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      await sendTransaction(
        [...tokenTransfer],
        ctx.payer,
        ctx.addressLookUpTable
      );
      const ata = getAssociatedTokenAddressInterface(
        new PublicKey(mint),
        new PublicKey(ctx.wallet.address)
      );
      const { parsed } = await getAtaInterface(
        getLightProtocolRpc(),
        new PublicKey(ata),
        new PublicKey(ctx.wallet.address),
        new PublicKey(mint)
      );
      expect(Number(parsed.amount)).to.equal(
        10 ** 9,
        "Incorrect token balance"
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
}

const createMintAndMintToSplAccount = async (ctx: TestContext) => {
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
    mintAuthority: ctx.newMember.address,
  });
  const senderAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS
  );
  const senderCTokenAta = getAssociatedTokenAddressInterface(
    new PublicKey(ephemeralKeypair.address),
    new PublicKey(ctx.newMember.address)
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
    ctx.addressLookUpTable
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
    true
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.multiWalletVault),
    true
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.newMember.address)
  );

  await createSplInterface(getLightProtocolRpc(), payer, mint);

  await wrap(
    getLightProtocolRpc(),
    payer,
    new PublicKey(senderAta),
    senderCTokenAta,
    newMember,
    mint,
    BigInt(10 ** 9)
  );

  await transferInterface(
    getLightProtocolRpc(),
    payer,
    senderCTokenAta,
    mint,
    recipientAta,
    newMember,
    10 ** 9
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
    mintAuthority: ctx.newMember.address,
  });
  const newMemberSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS
  );
  const senderCTokenAta = getAssociatedTokenAddressInterface(
    new PublicKey(ephemeralKeypair.address),
    new PublicKey(ctx.newMember.address)
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
    ctx.addressLookUpTable
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
    true
  );
  const recipientSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.multiWalletVault,
    TOKEN_2022_PROGRAM_ADDRESS
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
    new PublicKey(TOKEN_2022_PROGRAM_ADDRESS)
  );

  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.multiWalletVault),
    true
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.newMember.address)
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
    BigInt(10 ** 9 / 2)
  );

  await transferInterface(
    getLightProtocolRpc(),
    payer,
    senderCTokenAta,
    mint,
    recipientCTokenAta,
    newMember,
    10 ** 9 / 2
  );

  return address(mint.toString());
};

const createMintAndMintToCTokenAndCompressedAccount = async (
  ctx: TestContext
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
    mintAuthority: ctx.newMember.address,
  });
  const newMemberSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS
  );
  const senderCTokenAta = getAssociatedTokenAddressInterface(
    new PublicKey(ephemeralKeypair.address),
    new PublicKey(ctx.newMember.address)
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
    ctx.addressLookUpTable
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
    true
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
    new PublicKey(ctx.multiWalletVault)
  );

  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.multiWalletVault),
    true
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.newMember.address)
  );

  // transfer remaining to sender ctoken then send to multiwalletCToken
  await wrap(
    getLightProtocolRpc(),
    payer,
    new PublicKey(newMemberSplAta),
    senderCTokenAta,
    newMember,
    mint,
    BigInt(10 ** 9 / 2)
  );

  await transferInterface(
    getLightProtocolRpc(),
    payer,
    senderCTokenAta,
    mint,
    recipientCTokenAta,
    newMember,
    10 ** 9 / 2
  );

  return address(mint.toString());
};

const createMintAndMintToSplAndCTokenAndCompressedAccount = async (
  ctx: TestContext
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
    mintAuthority: ctx.newMember.address,
  });
  const newMemberSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.newMember,
    TOKEN_2022_PROGRAM_ADDRESS
  );
  const senderCTokenAta = getAssociatedTokenAddressInterface(
    new PublicKey(ephemeralKeypair.address),
    new PublicKey(ctx.newMember.address)
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
    ctx.addressLookUpTable
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
    true
  );
  const recipientSplAta = await getAssociatedTokenAccountAddress(
    ephemeralKeypair.address,
    ctx.multiWalletVault,
    TOKEN_2022_PROGRAM_ADDRESS
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
    new PublicKey(TOKEN_2022_PROGRAM_ADDRESS)
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
    new PublicKey(ctx.multiWalletVault)
  );

  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.multiWalletVault),
    true
  );
  await createAtaInterfaceIdempotent(
    getLightProtocolRpc(),
    payer,
    mint,
    new PublicKey(ctx.newMember.address)
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
    BigInt(remaining)
  );

  await transferInterface(
    getLightProtocolRpc(),
    payer,
    senderCTokenAta,
    mint,
    recipientCTokenAta,
    newMember,
    Math.floor(remaining)
  );

  return address(mint.toString());
};

async function createDestinationAta(mint: Address, ctx: TestContext) {
  if (!ctx.wallet || !ctx.payer) return;
  const destinationAta = await getAssociatedTokenAccountAddress(
    mint,
    ctx.wallet.address,
    TOKEN_2022_PROGRAM_ADDRESS
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
  destinationAtaExists: boolean
) {
  if (!ctx.wallet) throw new Error("vault not found.");
  return address(
    getAssociatedTokenAddressInterface(
      new PublicKey(mint),
      new PublicKey(ctx.wallet.address),
      true,
      destinationAtaExists
        ? new PublicKey(TOKEN_2022_PROGRAM_ADDRESS)
        : undefined
    ).toString()
  );
}

async function fetchVaultAtaAmount(
  ctx: TestContext,
  mint: Address,
  destinationAtaExists: boolean
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
      new PublicKey(mint)
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
  if (!ctx.index || !ctx.payer || !ctx.wallet) return;
  const tokenTransfer = await tokenTransferIntent({
    index: ctx.index,
    payer: ctx.payer,
    signers: [ctx.payer],
    destination: ctx.wallet.address,
    amount: 10 ** 9,
    compressed: ctx.compressed,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  await sendTransaction([...tokenTransfer], ctx.payer, ctx.addressLookUpTable);
}

async function runScenario(getCtx: () => TestContext, s: Scenario) {
  let ctx = getCtx();
  ctx = await createMultiWallet(ctx);

  const mint = await mintForScenario(ctx, s.source);

  if (!mint) throw new Error("Mint does not exist.");

  if (s.destinationAtaExists) {
    await createDestinationAta(mint, ctx);
  }

  await ensureDelegate(ctx);
  await doTokenTransfer(ctx, mint);

  const amount = await fetchVaultAtaAmount(ctx, mint, s.destinationAtaExists);
  expect(amount).to.equal(10 ** 9, "Incorrect token balance");
}
