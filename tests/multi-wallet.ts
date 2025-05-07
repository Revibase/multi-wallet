import {
  getCreateAccountInstruction,
  getTransferSolInstruction,
} from "@solana-program/system";
import {
  getInitializeMint2Instruction,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  Address,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  IInstruction,
  KeyPairSigner,
  lamports,
  pipe,
  Rpc,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  SolanaRpcApi,
} from "@solana/kit";
import { expect } from "chai";
import {
  changeConfig,
  createDomainConfig,
  createWallet,
  fetchDelegateData,
  fetchSettingsData,
  getMemberKeyString,
  Permission,
  Permissions,
  prepareTransactionMessage,
  prepareTransactionSync,
} from "../packages/sdk";

describe("multi_wallet", () => {
  const connection = createSolanaRpc("http://localhost:8899");
  const rpcSubscriptions = createSolanaRpcSubscriptions("ws://localhost:8900");
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc: connection,
    rpcSubscriptions,
  });

  let payer: KeyPairSigner;
  let wallet: KeyPairSigner;
  let settings: Address;
  let multi_wallet_vault: Address;

  xit("Set Up", async () => {
    await connection
      .requestAirdrop(
        address("CrDrYQs5fux37ZfdLeSFPEM6BUFH2WcyrvWm16bGMHMw"),
        lamports(BigInt(10 ** 9))
      )
      .send();
  });

  it("Create Multi Wallet!", async () => {
    payer = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );

    wallet = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );

    await connection
      .requestAirdrop(address(payer.address), lamports(BigInt(10 ** 9)))
      .send();

    await connection
      .requestAirdrop(wallet.address, lamports(BigInt(10 ** 9)))
      .send();

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const setDomainIx = await createDomainConfig({
      payer: payer,
      rpId: "revibase.com",
      origin: "https://auth.revibase.com",
      authority: wallet.address,
    });

    await sendTx(connection, [setDomainIx], payer, sendAndConfirm);

    const createWalletIx = await createWallet({
      feePayer: payer,
      initialMember: wallet,
    });

    await sendTx(connection, [createWalletIx], payer, sendAndConfirm);

    // Validation
    const delegateData = await fetchDelegateData(connection, wallet.address);
    settings = delegateData.multiWalletSettings;
    multi_wallet_vault = delegateData.multiWallet;
    const accountData = await fetchSettingsData(
      connection,
      delegateData.multiWalletSettings
    );
    expect(accountData.members.length).equal(1); // Only creator is a member
    expect(accountData.threshold).equal(1); // Single-sig wallet

    const transfer = getTransferSolInstruction({
      source: payer,
      destination: delegateData.multiWallet,
      amount: lamports(BigInt(10 ** 9 * 0.01)),
    });

    await sendTx(connection, [transfer], payer, sendAndConfirm);

    const vaultBalance = await connection.getBalance(multi_wallet_vault).send();
    expect(vaultBalance.value).equal(lamports(BigInt(10 ** 9 * 0.01)));
  });

  it("Add Member", async () => {
    const ix = await changeConfig({
      signers: [wallet],
      feePayer: payer,
      settings,
      configActions: [
        {
          type: "AddMembers",
          members: [
            {
              pubkey: payer.address,
              permissions: Permissions.fromPermissions([
                Permission.VoteTransaction,
              ]),
            },
          ],
        },
        { type: "SetThreshold", threshold: 2 },
      ],
    });

    await sendTx(connection, [ix], payer, sendAndConfirm);
    const accountData = await fetchSettingsData(connection, settings);
    const delegateData = await fetchDelegateData(connection, payer.address);
    expect(delegateData).equal(null);
    expect(accountData.members.length).equal(2); // Creator + Payer
    expect(getMemberKeyString(accountData.members[1].pubkey)).equal(
      payer.address.toString()
    );
    expect(accountData.threshold).equal(2);
  });

  it("Remove Member", async () => {
    const ix = await changeConfig({
      signers: [wallet, payer],
      feePayer: payer,
      settings,
      configActions: [
        {
          type: "RemoveMembers",
          members: [payer.address],
        },
        { type: "SetThreshold", threshold: 1 },
      ],
    });

    await sendTx(connection, [ix], payer, sendAndConfirm);

    const accountData = await fetchSettingsData(connection, settings);

    const delegateData = await fetchDelegateData(connection, payer.address);
    expect(delegateData).equal(null);
    expect(accountData.members.length).equal(1); // Only creator remains
    expect(getMemberKeyString(accountData.members[0].pubkey)).equal(
      wallet.address
    );
  });

  let test: KeyPairSigner;
  it("Set Member", async () => {
    test = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const ix = getTransferSolInstruction({
      source: payer,
      destination: multi_wallet_vault,
      amount: lamports(BigInt(10 ** 9 * 0.5)),
    });

    await sendTx(connection, [ix], payer, sendAndConfirm);

    const transferIx1 = getTransferSolInstruction({
      source: createNoopSigner(multi_wallet_vault),
      destination: wallet.address,
      amount: lamports(BigInt(10 ** 9 * 0.00002)),
    });
    const transferIx2 = getTransferSolInstruction({
      source: createNoopSigner(multi_wallet_vault),
      destination: test.address,
      amount: lamports(BigInt(10 ** 9 * 0.3)),
    });

    const recentBlockHash = await connection.getLatestBlockhash().send();
    const transactionMessageBytes = await prepareTransactionMessage(
      recentBlockHash.value.blockhash,
      payer.address,
      [transferIx1, transferIx2]
    );

    const result = await prepareTransactionSync({
      rpc: connection,
      feePayer: payer,
      transactionMessageBytes,
      signers: [wallet],
      settings,
    });

    const changeConfigIx = await changeConfig({
      signers: [wallet],
      feePayer: payer,
      settings,
      configActions: [
        {
          type: "EditPermissions",
          members: [
            {
              pubkey: wallet.address,
              permissions: Permissions.fromPermissions([
                Permission.IsInitialMember,
              ]),
            },
          ],
        },
        {
          type: "AddMembers",
          members: [{ pubkey: test.address, permissions: Permissions.all() }],
        },
        { type: "SetThreshold", threshold: 1 },
      ],
    });
    try {
      await sendTx(
        connection,
        [...result.ixs, changeConfigIx],
        payer,
        sendAndConfirm
      );
    } catch (error) {
      console.log(error);
    }

    const accountData = await fetchSettingsData(connection, settings);
    const delegateData = await fetchDelegateData(connection, test.address);
    expect(delegateData.multiWalletSettings.toString()).equal(
      settings.toString()
    );
    expect(delegateData.multiWallet.toString()).equal(
      multi_wallet_vault.toString()
    );
    expect(accountData.members.length).equal(2); // wallet + test
    expect(accountData.threshold).equal(1);
  });

  it("Ephermeral Tx", async () => {
    const ix = getTransferSolInstruction({
      source: payer,
      destination: multi_wallet_vault,
      amount: lamports(BigInt(10 ** 9 * 0.3)),
    });

    await sendTx(connection, [ix], payer, sendAndConfirm);

    const ephermeralKeypair = await createKeyPairSignerFromPrivateKeyBytes(
      crypto.getRandomValues(new Uint8Array(32))
    );

    const createAccount = getCreateAccountInstruction({
      payer: createNoopSigner(multi_wallet_vault),
      newAccount: ephermeralKeypair,
      space: getMintSize(),
      lamports: await connection
        .getMinimumBalanceForRentExemption(BigInt(getMintSize()))
        .send(),

      programAddress: TOKEN_PROGRAM_ADDRESS,
    });
    const createMint = getInitializeMint2Instruction({
      mint: ephermeralKeypair.address,
      decimals: 5,
      mintAuthority: multi_wallet_vault,
    });

    const recentBlockHash = await connection.getLatestBlockhash().send();
    const transactionMessageBytes = await prepareTransactionMessage(
      recentBlockHash.value.blockhash,
      payer.address,
      [createAccount, createMint]
    );

    const result = await prepareTransactionSync({
      rpc: connection,
      feePayer: payer,
      transactionMessageBytes,
      signers: [ephermeralKeypair, test],
      settings,
    });

    await sendTx(connection, [...result.ixs], payer, sendAndConfirm);

    const accountData = await fetchSettingsData(connection, settings);
    const delegateData = await fetchDelegateData(connection, test.address);
    expect(delegateData.multiWalletSettings.toString()).equal(
      settings.toString()
    );
    expect(delegateData.multiWallet.toString()).equal(
      multi_wallet_vault.toString()
    );
    expect(accountData.members.length).equal(2); //  test + wallet
    expect(accountData.threshold).equal(1);
  });
});
async function sendTx(
  connection: Rpc<SolanaRpcApi>,
  ixs: IInstruction[],
  payer: KeyPairSigner,
  sendAndConfirm
) {
  const latestBlockHash = await connection.getLatestBlockhash().send();
  const tx = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions(ixs, tx),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockHash.value, tx),
    async (tx) => await signTransactionMessageWithSigners(tx)
  );

  await sendAndConfirm(tx, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}
