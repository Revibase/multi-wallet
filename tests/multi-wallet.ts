import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SendTransactionError,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { expect } from "chai";
import {
  changeConfig,
  createDomainConfig,
  createWallet,
  fetchDelegateData,
  fetchDomainConfigData,
  fetchSettingsData,
  Permission,
  Permissions,
  prepareTransactionBundle,
} from "../sdk";

describe("multi_wallet", () => {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const payer = Keypair.generate();
  const wallet = Keypair.generate();
  let settings;
  let multi_wallet_vault;
  xit("Create Multi Wallet!", async () => {
    const txSig = await connection.requestAirdrop(
      payer.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(txSig);
    const txSig2 = await connection.requestAirdrop(
      wallet.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(txSig2);

    const createWalletIx = await createWallet({
      feePayer: payer.publicKey,
      walletAddress: {
        pubkey: wallet.publicKey,
        permissions: Permissions.all(),
      },
      metadata: new PublicKey("9n6LHACaLSjm6dyQ1unbP4y4Azigq5xGuzRCG2XRZf9v"),
    });
    const setDomainIx = await createDomainConfig({
      payer: payer.publicKey,
      rpId: "revibase.com",
      origin: "https://auth.revibase.com",
      authority: wallet.publicKey,
    });

    const tx = new Transaction().add(createWalletIx).add(setDomainIx);
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = payer.publicKey;

    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    await connection.confirmTransaction(sig);

    // Validation
    const delegateData = await fetchDelegateData(connection, wallet.publicKey);
    const domainData = await fetchDomainConfigData(connection, "revibase.com");
    console.log(domainData);
    settings = delegateData.multiWalletSettings;
    multi_wallet_vault = delegateData.multiWallet;
    const accountData = await fetchSettingsData(connection, settings);
    expect(accountData.members.length).equal(1); // Only creator is a member
    expect(accountData.threshold).equal(1); // Single-sig wallet
    expect(accountData.metadata.toBase58()).equal(
      "9n6LHACaLSjm6dyQ1unbP4y4Azigq5xGuzRCG2XRZf9v"
    );

    const vaultBalance = await connection.getBalance(multi_wallet_vault);
    expect(vaultBalance).equal(LAMPORTS_PER_SOL * 0.001);
  });

  xit("Add Member", async () => {
    const ix = await changeConfig({
      connection,
      settings,
      feePayer: payer.publicKey,
      configActions: [
        {
          type: "addMembers",
          members: [
            {
              pubkey: payer.publicKey,
              permissions: Permissions.fromPermissions([
                Permission.VoteTransaction,
              ]),
            },
          ],
        },
        { type: "setThreshold", threshold: 2 },
        { type: "setMetadata", metadata: null },
      ],
    });

    const result = await prepareTransactionBundle({
      connection,
      feePayer: payer.publicKey,
      instructions: [ix],
      settings,
      creator: wallet.publicKey,
      executor: wallet.publicKey,
    });

    for (const x of result) {
      const tx = new Transaction().add(...x.ixs);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = x.feePayer;
      await sendAndConfirmTransaction(
        connection,
        tx,
        x.signers.length > 1 ? [wallet, payer] : [payer]
      );
    }

    const accountData = await fetchSettingsData(connection, settings);
    const delegateData = await fetchDelegateData(connection, payer.publicKey);
    expect(delegateData).equal(null);
    expect(accountData.members.length).equal(2); // Creator + Payer
    expect(bs58.encode(accountData.members[1].pubkey.key)).equal(
      payer.publicKey.toBase58()
    );
    expect(accountData.threshold).equal(2);
  });

  xit("Remove Member", async () => {
    const ix = await changeConfig({
      connection,
      settings,
      feePayer: payer.publicKey,
      configActions: [
        {
          type: "removeMembers",
          members: [payer.publicKey],
        },
        { type: "setThreshold", threshold: 1 },
      ],
    });

    const result = await prepareTransactionBundle({
      connection,
      feePayer: payer.publicKey,
      instructions: [ix],
      settings,
      creator: wallet.publicKey,
      additionalVoters: [payer.publicKey],
      executor: wallet.publicKey,
    });

    for (const x of result) {
      try {
        const tx = new Transaction().add(...x.ixs);
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = x.feePayer;
        await sendAndConfirmTransaction(
          connection,
          tx,
          x.signers.length > 1 ? [wallet, payer] : [payer]
        );
      } catch (error) {
        console.log(await (error as SendTransactionError).getLogs(connection));
      }
    }
    const accountData = await fetchSettingsData(connection, settings);

    const delegateData = await fetchDelegateData(connection, payer.publicKey);
    expect(delegateData).equal(null);
    expect(accountData.members.length).equal(1); // Only creator remains
    expect(bs58.encode(accountData.members[0].pubkey.key)).equal(
      wallet.publicKey.toBase58()
    );
  });

  const test = Keypair.generate();
  xit("Set Member", async () => {
    const ix = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: multi_wallet_vault,
      lamports: LAMPORTS_PER_SOL * 0.5,
    });

    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(connection, tx, [payer]);

    const transferIx1 = SystemProgram.transfer({
      fromPubkey: multi_wallet_vault,
      toPubkey: wallet.publicKey,
      lamports: LAMPORTS_PER_SOL * 0.00002,
    });
    const transferIx2 = SystemProgram.transfer({
      fromPubkey: multi_wallet_vault,
      toPubkey: test.publicKey,
      lamports: LAMPORTS_PER_SOL * 0.001,
    });

    const changeConfigIx = await changeConfig({
      connection,
      settings,
      feePayer: payer.publicKey,
      configActions: [
        {
          type: "setMembers",
          members: [
            {
              pubkey: test.publicKey,
              permissions: Permissions.all(),
            },
          ],
        },
        { type: "setThreshold", threshold: 1 },
      ],
    });

    const result = await prepareTransactionBundle({
      connection,
      feePayer: payer.publicKey,
      instructions: [transferIx1, transferIx2, changeConfigIx],
      settings,
      creator: wallet.publicKey,
      executor: wallet.publicKey,
    });
    for (const x of result) {
      const tx = new Transaction().add(...x.ixs);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = x.feePayer;
      await sendAndConfirmTransaction(
        connection,
        tx,
        x.signers.length > 1 ? [wallet, payer] : [payer]
      );
    }

    const accountData = await fetchSettingsData(connection, settings);
    const delegateData = await fetchDelegateData(connection, test.publicKey);
    expect(delegateData.multiWalletSettings.toBase58()).equal(
      settings.toBase58()
    );
    expect(delegateData.multiWallet.toBase58()).equal(
      multi_wallet_vault.toBase58()
    );
    expect(accountData.members.length).equal(1); // wallet + test
    expect(accountData.threshold).equal(1);
  });

  xit("Ephermeral Tx", async () => {
    const ix = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: multi_wallet_vault,
      lamports: LAMPORTS_PER_SOL * 0.2,
    });

    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(connection, tx, [payer]);

    const ephermeralKeypair = Keypair.generate();
    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const createAccount = SystemProgram.createAccount({
      fromPubkey: multi_wallet_vault,
      newAccountPubkey: ephermeralKeypair.publicKey,
      space: MINT_SIZE,
      lamports: lamports,
      programId: TOKEN_PROGRAM_ID,
    });
    const createMint = createInitializeMintInstruction(
      ephermeralKeypair.publicKey,
      5,
      multi_wallet_vault,
      null
    );

    const result = await prepareTransactionBundle({
      connection,
      feePayer: payer.publicKey,
      instructions: [createAccount, createMint],
      settings,
      creator: test.publicKey,
      executor: test.publicKey,
    });
    for (const x of result) {
      const tx = new Transaction().add(...x.ixs);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = x.feePayer;
      await sendAndConfirmTransaction(
        connection,
        tx,
        x.signers.length > 2
          ? [test, payer, ephermeralKeypair]
          : x.signers.length > 1
          ? [test, payer]
          : [payer]
      );
    }

    const accountData = await fetchSettingsData(connection, settings);
    const delegateData = await fetchDelegateData(connection, test.publicKey);
    expect(delegateData.multiWalletSettings.toBase58()).equal(
      settings.toBase58()
    );
    expect(delegateData.multiWallet.toBase58()).equal(
      multi_wallet_vault.toBase58()
    );
    expect(accountData.members.length).equal(1); //  test
    expect(accountData.threshold).equal(1);
  });
});
