import { batchAddressTree } from "@lightprotocol/stateless.js";
import {
  addWhitelistedAddressTrees,
  createDomainConfig,
  createGlobalCounter,
  createUserAccounts,
  createWallet,
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
  getAddressEncoder,
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

  const payer = await createKeyPairSignerFromPrivateKeyBytes(payerSeed, true);

  const payerSecretKey = new Uint8Array([
    ...payerSeed,
    ...getAddressEncoder().encode(address(payer.address.toString())),
  ]);

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
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      "Sysvar1nstructions1111111111111111111111111",
      "auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg",
      "SysvarS1otHashes111111111111111111111111111",
      "3C6AdJiD9qxMqZTmB53b5HC5Yfq2Bb57XAzYDzu4YDcj",
      "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
      "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
      "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
      "GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy",
      "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
      "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh",
      "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA",
      "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq",
      "bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU",
      "oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto",
      "cpi15BoVPKgEPw5o8wc2T816GE7b378nMXnhH3Xbq4y",
      "bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi",
      "oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg",
      "cpi2yGapXUR3As5SjnHBAVvmApNiLsbeZpF3euWnW6B",
      "bmt3ccLd4bqSVZVeCJnH1F6C8jNygAhaDfxDwePyyGb",
      "oq3AxjekBWgo64gpauB6QtuZNesuv19xrhaC1ZM1THQ",
      "cpi3mbwMpSX8FAGMZVP85AwxqCaQMfEk9Em1v8QK9Rf",
    ].map(address),
  });
  await sendTransaction([extendIx], payer);

  const extendIx2 = getExtendLookupTableInstruction({
    address: lut,
    authority: payer,
    payer: payer,
    addresses: [
      "bmt4d3p1a4YQgk9PeZv5s4DBUmbF5NxqYpk9HGjQsd8",
      "oq4ypwvVGzCUMoiKKHWh4S1SgZJ9vCvKpcz6RT6A8dq",
      "cpi4yyPDc4bCgHAnsenunGA8Y77j3XEDyjgfyCKgcoc",
      "bmt5yU97jC88YXTuSukYHa8Z5Bi2ZDUtmzfkDTA2mG2",
      "oq5oh5ZR3yGomuQgFduNDzjtGvVWfDRGLuDVjv9a96P",
      "cpi5ZTjdgYpZ1Xr7B1cMLLUE81oTtJbNNAyKary2nV6",
      "amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx",
      "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg",
      "r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti",
      "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
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
    payerSecretKey,
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
  const newMemberSeed = crypto.getRandomValues(new Uint8Array(32));

  const payer = await createKeyPairSignerFromPrivateKeyBytes(payerSeed, true);
  const wallet = await createKeyPairSignerFromPrivateKeyBytes(walletSeed, true);
  const newMember = await createKeyPairSignerFromPrivateKeyBytes(
    newMemberSeed,
    true
  );

  const payerSecretKey = new Uint8Array([
    ...payerSeed,
    ...getAddressEncoder().encode(address(payer.address.toString())),
  ]);

  const newMemberSecretKey = new Uint8Array([
    ...newMemberSeed,
    ...getAddressEncoder().encode(address(newMember.address.toString())),
  ]);

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
  const instructions = await createWallet({
    payer,
    initialMember: wallet,
    index: createIndex,
  });

  await sendTransaction([instructions], payer);

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
    newMember,
    payerSecretKey,
    newMemberSecretKey,
  };
}
