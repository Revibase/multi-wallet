import {
  defaultStaticAccountsStruct,
  getDefaultAddressTreeInfo,
  lightSystemProgram,
  localTestActiveStateTreeInfos,
} from "@lightprotocol/stateless.js";
import {
  createDomainConfig,
  createGlobalCounter,
  createGlobalUsers,
  createWallet,
  fetchMaybeGlobalCounter,
  getGlobalCounterAddress,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  initializeMultiWallet,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Permission,
  Permissions,
} from "@revibase/wallet-sdk";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  fetchAddressesForLookupTables,
  getProgramDerivedAddress,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import {
  AIRDROP_AMOUNT,
  LOCAL_INDEXER_URL,
  LOCAL_PROVER_URL,
  LOCAL_RPC_URL,
  LOCAL_WS_URL,
} from "../constants";
import type { TestContext } from "../types";
import { sendTransaction } from "./transaction";
/**
 * Sets up a fresh test environment for each test
 */
export async function setupTestEnvironment(
  compressed = true
): Promise<TestContext> {
  const connection = createSolanaRpc(LOCAL_RPC_URL);
  initializeMultiWallet({
    rpcEndpoint: LOCAL_RPC_URL,
    compressionApiEndpoint: LOCAL_INDEXER_URL,
    proverEndpoint: LOCAL_PROVER_URL,
  });
  const rpcSubscriptions = createSolanaRpcSubscriptions(LOCAL_WS_URL);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc: connection,
    rpcSubscriptions,
  });

  // Create keypairs with deterministic seeds for testing
  // Using deterministic seeds for testing makes tests more reproducible
  const payerSeed = crypto.getRandomValues(new Uint8Array(32));
  const walletSeed = crypto.getRandomValues(new Uint8Array(32));

  const payer = await createKeyPairSignerFromPrivateKeyBytes(payerSeed);
  const wallet = await createKeyPairSignerFromPrivateKeyBytes(walletSeed);

  // Fund the payer account
  await connection.requestAirdrop(payer.address, AIRDROP_AMOUNT).send();
  const recentSlot = await connection
    .getSlot({ commitment: "finalized" })
    .send();
  const ix = await getCreateLookupTableInstructionAsync({
    authority: payer,
    recentSlot,
  });
  await sendTransaction(connection, [ix], payer, sendAndConfirm);
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
  await sendTransaction(connection, [extendIx], payer, sendAndConfirm);

  const addressLookUpTable = await fetchAddressesForLookupTables(
    [lut],
    connection
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
    connection,
    rpcSubscriptions,
    sendAndConfirm,
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
  let globalCounter = await fetchMaybeGlobalCounter(
    ctx.connection,
    await getGlobalCounterAddress()
  );

  if (!globalCounter.exists) {
    const globalCounterIx = await createGlobalCounter({ payer: ctx.payer });

    await sendTransaction(
      ctx.connection,
      [globalCounterIx],
      ctx.payer,
      ctx.sendAndConfirm
    );
    globalCounter = await fetchMaybeGlobalCounter(
      ctx.connection,
      await getGlobalCounterAddress()
    );
  }

  // Set up domain config
  const setDomainIx = await createDomainConfig({
    payer: ctx.payer,
    rpId: ctx.rpId,
    origins: [ctx.origin, "happy"],
    authority: ctx.wallet.address,
  });

  await sendTransaction(
    ctx.connection,
    [setDomainIx],
    ctx.payer,
    ctx.sendAndConfirm
  );

  const createGlobalUserIxs = await createGlobalUsers({
    members: [ctx.wallet.address, ctx.payer.address],
    payer: ctx.payer,
  });

  await sendTransaction(
    ctx.connection,
    [createGlobalUserIxs],
    ctx.payer,
    ctx.sendAndConfirm
  );

  const createIndex = globalCounter.exists ? globalCounter.data.index : null;

  const settings = await getSettingsFromIndex(createIndex);
  const multiWallet = await getMultiWalletFromSettings(settings);

  // Create wallet
  const { instructions } = await createWallet({
    payer: ctx.payer,
    initialMember: ctx.wallet,
    permissions: Permissions.fromPermissions([
      Permission.InitiateTransaction,
      Permission.VoteTransaction,
      Permission.ExecuteTransaction,
      Permission.IsDelegate,
    ]),
    index: createIndex,
    compressed: ctx.compressed,
  });

  await sendTransaction(
    ctx.connection,
    instructions,
    ctx.payer,
    ctx.sendAndConfirm
  );

  // Return a new context with the updated settings and multiWalletVault
  return {
    ...ctx,
    index: createIndex,
    multiWalletVault: multiWallet,
  };
}
