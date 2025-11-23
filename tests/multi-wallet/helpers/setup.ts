import { batchAddressTree } from "@lightprotocol/stateless.js";
import {
  addWhitelistedAddressTrees,
  createDomainConfig,
  createGlobalCounter,
  createUserAccounts,
  createWallet,
  DelegateOp,
  fetchGlobalCounter,
  fetchMaybeGlobalCounter,
  fetchMaybeWhitelistedAddressTree,
  getDomainConfigAddress,
  getGlobalCounterAddress,
  getSolanaRpc,
  getWalletAddressFromIndex,
  getWhitelistedAddressTreesAddress,
  initialize,
  UserRole,
} from "@revibase/core";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  fetchAddressesForLookupTables,
} from "gill";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
} from "gill/programs";
import {
  AIRDROP_AMOUNT,
  LOCAL_INDEXER_URL,
  LOCAL_PROVER_URL,
  LOCAL_RPC_URL,
} from "../constants.ts";
import type { TestContext } from "../types.ts";
import { sendTransaction } from "./transaction.ts";
/**
 * Sets up a fresh test environment for each test
 */
export async function setupTestEnvironment(): Promise<TestContext> {
  initialize({
    rpcEndpoint: LOCAL_RPC_URL,
    compressionApiEndpoint: LOCAL_INDEXER_URL,
    proverEndpoint: LOCAL_PROVER_URL,
  });
  // Create keypairs with deterministic seeds for testing
  const payerSeed = crypto.getRandomValues(new Uint8Array(32));
  const walletSeed = crypto.getRandomValues(new Uint8Array(32));

  const payer = await createKeyPairSignerFromPrivateKeyBytes(payerSeed);

  // Fund the payer account
  await getSolanaRpc().requestAirdrop(payer.address, AIRDROP_AMOUNT).send();
  const recentSlot = await getSolanaRpc()
    .getSlot({ commitment: "finalized" })
    .send();
  const ix = await getCreateLookupTableInstructionAsync({
    authority: payer,
    recentSlot,
  });
  await sendTransaction([ix], payer);
  // Wait for airdrop to be confirmed
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const [lut] = await findAddressLookupTablePda({
    authority: payer.address,
    recentSlot,
  });

  const extendIx = getExtendLookupTableInstruction({
    address: lut,
    authority: payer,
    payer,
    addresses: [
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      "Sysvar1nstructions1111111111111111111111111",
      "auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg",
      "SysvarS1otHashes111111111111111111111111111",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "3C6AdJiD9qxMqZTmB53b5HC5Yfq2Bb57XAzYDzu4YDcj",
      "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
      "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
      "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
      "GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy",
      "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
      "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh",
      "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA",
      "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq",
      "smt1NamzXdq4AMqS2fS2F1i5KTYPZRhoHgWx38d8WsT",
      "nfq1NvQDJ2GEgnS8zt9prAe8rjjpAW1zFkrvZoBR148",
      "amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2",
      "aq1S9z4reTSQAdgWHGD2zDaS39sjGrAxbR31vxJ2F4F",
      "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
      "6MZszp7ihPjUeoi8RJs9NNC4jBxi7beiqvXHJhxd7fe",
      "smt2rJAFdyJJupwMKAqTNAJwvjhmiZ4JYGZmbVRw1Ho",
      "nfq2hgS7NYemXsFaFUCe3EMXSDSfnZnAe27jC6aPP1X",
      "smt3AFtReRGVcrP11D6bSLEaKdUmrGfaTNowMVccJeu",
    ].map(address),
  });
  await sendTransaction([extendIx], payer);

  const extendIx2 = getExtendLookupTableInstruction({
    address: lut,
    authority: payer,
    payer: payer,
    addresses: [
      "nfq3de4qt9d3wHxXWy1wcge3EXhid25mCr12bNWFdtV",
      "smt4vjXvdjDFzvRMUxwTWnSy4c7cKkMaHuPrGsdDH7V",
      "nfq4Ncp1vk3mFnCQ9cvwidp9k2L6fxEyCo2nerYD25A",
      "smt5uPaQT9n6b1qAkgyonmzRxtuazA53Rddwntqistc",
      "nfq5b5xEguPtdD6uPetZduyrB5EUqad7gcUE46rALau",
      "smt6ukQDSPPYHSshQovmiRUjG9jGFq2hW9vgrDFk5Yz",
      "nfq6uzaNZ5n3EWF4t64M93AWzLGt5dXTikEA9fFRktv",
      "smt7onMFkvi3RbyhQCMajudYQkB1afAFt9CDXBQTLz6",
      "nfq7yytdKkkLabu1KpvLsa5VPkvCT4jPWus5Yi74HTH",
      "smt8TYxNy8SuhAdKJ8CeLtDkr2w6dgDmdz5ruiDw9Y9",
      "nfq8vExDykci3VUSpj9R1totVst87hJfFWevNK4hiFb",
      "smt9ReAYRF5eFjTd5gBJMn5aKwNRcmp3ub2CQr2vW7j",
      "nfq9KFpNQL45ppP6ZG7zBpUeN18LZrNGkKyvV1kjTX2",
      "smtAvYA5UbTRyKAkAj5kHs1CmrA42t6WkVLi4c6mA1f",
      "nfqAroCRkcZBgsAJDNkptKpsSWyM6cgB9XpWNNiCEC4",
      "2cLqZJrYMuCzKdSZBoWxZ3tXoeCMmMyDiuy6UBaKnbmK",
      "5tgzUZaVtfnnSEBgmBDtJj6PdgYCnA1uaEGEUi3y5Njg",
    ].map(address),
  });
  await sendTransaction([extendIx2], payer);

  const addressLookUpTable = await fetchAddressesForLookupTables(
    [lut],
    getSolanaRpc()
  );

  const globalAccountAddress = await fetchMaybeGlobalCounter(
    getSolanaRpc(),
    await getGlobalCounterAddress()
  );
  if (!globalAccountAddress.exists) {
    const globalCounterIx = await createGlobalCounter({
      payer,
    });

    await sendTransaction([globalCounterIx], payer);
  }

  const whitelistedAddressTreesAccount = await fetchMaybeWhitelistedAddressTree(
    getSolanaRpc(),
    await getWhitelistedAddressTreesAddress()
  );

  if (!whitelistedAddressTreesAccount.exists) {
    const addWhitelistedAddressTree = await addWhitelistedAddressTrees({
      admin: payer,
      addressTree: address(batchAddressTree),
    });
    await sendTransaction([addWhitelistedAddressTree], payer);
  }

  return {
    compressed: true,
    addressLookUpTable,
    payer: undefined,
    wallet: undefined,
    index: undefined,
    multiWalletVault: undefined,
    rpId: undefined,
    origin: undefined,
    domainConfig: undefined,
  };
}

/**
 * Creates a multi-wallet and sets up the domain config
 */
export async function createMultiWallet(
  ctx: TestContext
): Promise<TestContext> {
  const rpId = crypto.randomUUID();
  const origin = crypto.randomUUID();

  const payerSeed = crypto.getRandomValues(new Uint8Array(32));
  const walletSeed = crypto.getRandomValues(new Uint8Array(32));

  const payer = await createKeyPairSignerFromPrivateKeyBytes(payerSeed);
  const wallet = await createKeyPairSignerFromPrivateKeyBytes(walletSeed);

  // Fund the payer account
  await getSolanaRpc().requestAirdrop(payer.address, AIRDROP_AMOUNT).send();
  await getSolanaRpc().requestAirdrop(wallet.address, AIRDROP_AMOUNT).send();

  const domainConfig = await getDomainConfigAddress({
    rpId,
  });

  // Set up domain config
  const setDomainIx = await createDomainConfig({
    payer,
    rpId,
    origins: [origin, "happy"],
    authority: wallet,
  });

  await sendTransaction([setDomainIx], payer);

  const globalCounter = await fetchGlobalCounter(
    getSolanaRpc(),
    await getGlobalCounterAddress()
  );
  const createIndex = globalCounter.data.index;
  const multiWalletVault = await getWalletAddressFromIndex(createIndex);

  // Create wallet
  const { instructions } = await createWallet({
    payer,
    initialMember: wallet,
    index: createIndex,
    delegateOperation: DelegateOp.Ignore,
  });

  await sendTransaction(instructions, payer);

  const instruction = await createUserAccounts({
    createUserArgs: [
      {
        member: payer,
        role: UserRole.Member,
      },
    ],
    payer,
  });

  await sendTransaction([instruction], payer);

  // Return a new context with the updated settings and multiWalletVault
  return {
    ...ctx,
    rpId,
    origin,
    domainConfig,
    index: createIndex,
    multiWalletVault,
    payer,
    wallet,
  };
}
