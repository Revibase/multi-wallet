import {
  createDomainConfig,
  createWallet,
  fetchDelegate,
  getDelegateAddress,
  getMultiWalletFromSettings,
} from "@revibase/wallet-sdk";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import { AIRDROP_AMOUNT, LOCAL_RPC_URL, LOCAL_WS_URL } from "../constants";
import type { TestContext } from "../types";
import { sendTransaction } from "./transaction";

/**
 * Sets up a fresh test environment for each test
 */
export async function setupTestEnvironment(): Promise<TestContext> {
  const connection = createSolanaRpc(LOCAL_RPC_URL);
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

  // Wait for airdrop to be confirmed
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const rpId = crypto.randomUUID();
  const origin = crypto.randomUUID();

  return {
    connection,
    rpcSubscriptions,
    sendAndConfirm,
    payer,
    wallet,
    settings: undefined, // Will be set during wallet creation
    multiWalletVault: undefined, // Will be set during wallet creation
    rpId,
    origin,
  };
}

/**
 * Creates a multi-wallet and sets up the domain config
 */
export async function createMultiWallet(
  ctx: TestContext
): Promise<TestContext> {
  // Set up domain config
  const setDomainIx = await createDomainConfig({
    payer: ctx.payer,
    rpId: ctx.rpId,
    origin: ctx.origin,
    authority: ctx.wallet.address,
  });

  await sendTransaction(
    ctx.connection,
    [setDomainIx],
    ctx.payer,
    ctx.sendAndConfirm
  );

  // Create wallet
  const createWalletIxs = await createWallet({
    feePayer: ctx.payer,
    initialMember: ctx.wallet,
    createKey: crypto.getRandomValues(new Uint8Array(32)),
  });

  await sendTransaction(
    ctx.connection,
    createWalletIxs,
    ctx.payer,
    ctx.sendAndConfirm
  );

  // Get wallet data
  const delegateData = await fetchDelegate(
    ctx.connection,
    await getDelegateAddress(ctx.wallet.address)
  );
  const multiWallet = await getMultiWalletFromSettings(
    delegateData.data.multiWalletSettings
  );
  // Return a new context with the updated settings and multiWalletVault
  return {
    ...ctx,
    settings: delegateData.data.multiWalletSettings,
    multiWalletVault: multiWallet,
  };
}
