import {
  createDomainConfig,
  createGlobalCounter,
  createUserAccounts,
  createWallet,
  fetchGlobalCounter,
  fetchMaybeGlobalCounter,
  getDomainConfigAddress,
  getGlobalCounterAddress,
  getSolanaRpc,
  getWalletAddressFromIndex,
  initialize,
  UserRole,
} from "@revibase/core";
import {
  address,
  extractBytesFromKeyPairSigner,
  fetchAddressesForLookupTables,
  generateExtractableKeyPairSigner,
} from "gill";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
} from "gill/programs";
import {
  AIRDROP_AMOUNT,
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
  });

  const payer = await generateExtractableKeyPairSigner();

  const payerSecretKey = await extractBytesFromKeyPairSigner(payer);

  // Fund the payer account
  await getSolanaRpc().requestAirdrop(payer.address, AIRDROP_AMOUNT).send();

  const globalAccountAddress = await fetchMaybeGlobalCounter(
    getSolanaRpc(),
    await getGlobalCounterAddress(),
  );
  if (!globalAccountAddress.exists) {
    const globalCounterIx = await createGlobalCounter({
      payer,
    });

    await sendTransaction([globalCounterIx], payer);
  }

  return {
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
  ctx: TestContext,
): Promise<TestContext> {
  const rpId = crypto.randomUUID();
  const origin = crypto.randomUUID();

  const payer = await generateExtractableKeyPairSigner();
  const wallet = await generateExtractableKeyPairSigner();
  const newMember = await generateExtractableKeyPairSigner();

  const payerSecretKey = await extractBytesFromKeyPairSigner(payer);

  const newMemberSecretKey = await extractBytesFromKeyPairSigner(newMember);

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
    await getGlobalCounterAddress(),
  );
  const createIndex = globalCounter.data.index;
  const multiWalletVault = await getWalletAddressFromIndex(createIndex);

  const instructions = await createWallet({
    payer,
    initialMember: wallet,
    index: createIndex,
  });

  await sendTransaction([instructions], payer);

  const instruction = await createUserAccounts({
    createUserArgs: {
      member: payer,
      role: UserRole.Member,
    },
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
