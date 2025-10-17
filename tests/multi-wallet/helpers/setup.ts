import {
  defaultStaticAccountsStruct,
  getDefaultAddressTreeInfo,
  lightSystemProgram,
  localTestActiveStateTreeInfos,
} from "@lightprotocol/stateless.js";
import {
  createDelegates,
  createDomainConfig,
  createGlobalCounter,
  createWallet,
  fetchGlobalCounter,
  fetchMaybeGlobalCounter,
  getGlobalCounterAddress,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  getSolanaRpc,
  initializeMultiWallet,
  MULTI_WALLET_PROGRAM_ADDRESS,
} from "@revibase/wallet";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  fetchAddressesForLookupTables,
  getProgramDerivedAddress,
} from "gill";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAddressLookupTablePda,
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
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
export async function setupTestEnvironment(
  compressed = true
): Promise<TestContext> {
  initializeMultiWallet({
    rpcEndpoint: LOCAL_RPC_URL,
    compressionApiEndpoint: LOCAL_INDEXER_URL,
    proverEndpoint: LOCAL_PROVER_URL,
  });
  // Create keypairs with deterministic seeds for testing
  // Using deterministic seeds for testing makes tests more reproducible
  const payerSeed = crypto.getRandomValues(new Uint8Array(32));
  const walletSeed = crypto.getRandomValues(new Uint8Array(32));

  const payer = await createKeyPairSignerFromPrivateKeyBytes(payerSeed);
  const wallet = await createKeyPairSignerFromPrivateKeyBytes(walletSeed);

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
  const {
    accountCompressionAuthority,
    accountCompressionProgram,
    registeredProgramPda,
  } = defaultStaticAccountsStruct();
  const { tree, queue } = getDefaultAddressTreeInfo();
  const extendIx = getExtendLookupTableInstruction({
    address: lut,
    authority: payer,
    payer: payer,
    addresses: [
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      SYSTEM_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
      address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
      address("Sysvar1nstructions1111111111111111111111111"),
      address("auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg"),
      address("SysvarS1otHashes111111111111111111111111111"),
      address("3C6AdJiD9qxMqZTmB53b5HC5Yfq2Bb57XAzYDzu4YDcj"),
      address("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY"),
      address("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"),
      address("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK"),
      address(lightSystemProgram),
      address(accountCompressionProgram.toString()),
      address(accountCompressionAuthority.toString()),
      address(registeredProgramPda.toString()),
      address(tree.toString()),
      address(queue.toString()),
      ...localTestActiveStateTreeInfos().flatMap((x) => [
        address(x.tree.toString()),
        address(x.queue.toString()),
      ]),
    ],
  });
  await sendTransaction([extendIx], payer);

  const addressLookUpTable = await fetchAddressesForLookupTables(
    [lut],
    getSolanaRpc()
  );

  const rpId = crypto.randomUUID();
  const origin = crypto.randomUUID();

  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      new TextEncoder().encode("domain_config"),
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId))
      ),
    ],
  });

  return {
    compressed,
    payer,
    wallet,
    index: undefined, // Will be set during wallet creation
    multiWalletVault: undefined, // Will be set during wallet creation
    rpId,
    origin,
    addressLookUpTable,
    domainConfig,
  };
}

/**
 * Creates a multi-wallet and sets up the domain config
 */
export async function createMultiWallet(
  ctx: TestContext
): Promise<TestContext> {
  const globalCounter = await fetchMaybeGlobalCounter(
    getSolanaRpc(),
    await getGlobalCounterAddress()
  );

  let createIndex;
  if (!globalCounter.exists) {
    const globalCounterIx = await createGlobalCounter({ payer: ctx.payer });

    await sendTransaction([globalCounterIx], ctx.payer);
    const result = await fetchGlobalCounter(
      getSolanaRpc(),
      await getGlobalCounterAddress()
    );
    createIndex = result.data.index;
  } else {
    createIndex = globalCounter.data.index;
  }

  // Set up domain config
  const setDomainIx = await createDomainConfig({
    payer: ctx.payer,
    rpId: ctx.rpId,
    origins: [ctx.origin, "happy"],
    authority: ctx.wallet.address,
    metadataUrl: "",
  });

  await sendTransaction([setDomainIx], ctx.payer);

  const createDelegateIxs = await createDelegates({
    createDelegateArgs: [
      { member: ctx.wallet, isPermanentMember: false, apiUrl: undefined },
      { member: ctx.payer, isPermanentMember: false, apiUrl: undefined },
    ],
    payer: ctx.payer,
  });

  await sendTransaction([createDelegateIxs], ctx.payer);

  const settings = await getSettingsFromIndex(createIndex);
  const multiWallet = await getMultiWalletFromSettings(settings);

  // Create wallet
  const { instructions } = await createWallet({
    payer: ctx.payer,
    initialMember: ctx.wallet,
    index: createIndex,
    compressed: ctx.compressed,
    setAsDelegate: false,
  });

  await sendTransaction(instructions, ctx.payer);

  // Return a new context with the updated settings and multiWalletVault
  return {
    ...ctx,
    index: createIndex,
    multiWalletVault: multiWallet,
  };
}
