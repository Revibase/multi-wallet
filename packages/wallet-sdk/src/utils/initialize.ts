import {
  createRpc,
  Rpc as LightProtocolRpc,
} from "@lightprotocol/stateless.js";
import { safeRace } from "@solana/promises";
import {
  createBlockHeightExceedencePromiseFactory,
  createRecentSignatureConfirmationPromiseFactory,
} from "@solana/transaction-confirmation";
import { registerWallet } from "@wallet-standard/core";
import {
  createSolanaClient,
  type Commitment,
  type CompilableTransactionMessage,
  type Rpc,
  type RpcSubscriptions,
  type SendAndConfirmTransactionWithSignersFunction,
  type Signature,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionSigner,
} from "gill";
import { estimateComputeUnitLimitFactory } from "gill/programs";
import { createRevibaseAdapter } from "../adapter/core";
import { RevibaseWallet } from "../adapter/wallet";
import type { JitoTipsConfig } from "../types";
import { getRandomPayer } from "./internal";

let globalSolanaRpcEndpoint: string | null = null;

let lightProtocolRpc: LightProtocolRpc | null = null;
let globalSolanaRpc: Rpc<SolanaRpcApi> | null = null;
let globalSolanaRpcSubscription:
  | (RpcSubscriptions<SolanaRpcSubscriptionsApi> & string)
  | null = null;
let globalSendAndConfirmTransaction: SendAndConfirmTransactionWithSignersFunction | null =
  null;

let globalComputeBudgetEstimate:
  | ((
      transactionMessage:
        | CompilableTransactionMessage
        | (TransactionMessage & TransactionMessageWithFeePayer),
      config?: any
    ) => Promise<number>)
  | null = null;

let globalConfirmRecentTransaction:
  | ((config: {
      signature: Signature;
      lastValidBlockHeight: bigint;
      commitment: Commitment;
    }) => Promise<void>)
  | null = null;

let globalFeePayer: TransactionSigner | null = null;
let globalPayerEndpoint: string | null = null;
let globalJitoTipsConfig: JitoTipsConfig | null = null;
let globalAuthUrl: string | null = null;
let globalExpectedOrigin: string | null = null;
let globalExpectedRPID: string | null = null;

export function getSolanaRpcEndpoint() {
  if (!globalSolanaRpcEndpoint) throw new Error("Rpc is not initialized yet.");
  return globalSolanaRpcEndpoint;
}

export function getLightProtocolRpc() {
  if (!lightProtocolRpc) throw new Error("Rpc is not initialized yet");
  return lightProtocolRpc;
}

export function getSolanaRpc() {
  if (!globalSolanaRpc) throw new Error("Rpc is not initialized yet");
  return globalSolanaRpc;
}

export function getSolanaRpcSubscription() {
  if (!globalSolanaRpcSubscription)
    throw new Error("Rpc is not initiazlied yet.");
  return globalSolanaRpcSubscription;
}

export function getSendAndConfirmTransaction() {
  if (!globalSendAndConfirmTransaction)
    throw new Error("Rpc is not initialized yet.");
  return globalSendAndConfirmTransaction;
}

export function getComputeBudgetEstimate() {
  if (!globalComputeBudgetEstimate)
    throw new Error("Rpc is not initialized yet");
  return globalComputeBudgetEstimate;
}

export function getConfirmRecentTransaction() {
  if (!globalConfirmRecentTransaction)
    throw new Error("Rpc is not initialized yet.");
  return globalConfirmRecentTransaction;
}

export async function getFeePayer() {
  if (!globalFeePayer) {
    globalFeePayer = await getRandomPayer(
      globalPayerEndpoint ?? "https://api.revibase.com"
    );
  }
  return globalFeePayer;
}

export function getJitoTipsConfig() {
  if (!globalJitoTipsConfig) throw new Error("Jito Bundle Config is not set.");
  return globalJitoTipsConfig;
}

export function getAuthUrl() {
  return globalAuthUrl ?? "https://auth.revibase.com";
}

export function getExpectedOrigin() {
  return globalExpectedOrigin ?? "https://auth.revibase.com";
}

export function getExpectedRPID() {
  return globalExpectedRPID ?? "revibase.com";
}

export function uninitializeMultiWallet() {
  lightProtocolRpc = null;
  globalSolanaRpc = null;
  globalSolanaRpcEndpoint = null;
  globalFeePayer = null;
  globalPayerEndpoint = null;
  globalJitoTipsConfig = null;
  globalAuthUrl = null;
  globalExpectedOrigin = null;
  globalExpectedRPID = null;
  globalSolanaRpcSubscription = null;
  globalSendAndConfirmTransaction = null;
  globalComputeBudgetEstimate = null;
  globalConfirmRecentTransaction = null;
}

export function initializeMultiWallet({
  rpcEndpoint,
  payerEndpoint,
  jitoTipsConfig,
  compressionApiEndpoint,
  proverEndpoint,
  authUrl,
  expectedOrigin,
  expectedRPID,
  authorizedClients,
  additionalInfo,
}: {
  rpcEndpoint: string;
  payerEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  compressionApiEndpoint?: string;
  proverEndpoint?: string;
  authUrl?: string;
  expectedOrigin?: string;
  expectedRPID?: string;
  authorizedClients?: { publicKey: string; url: string };
  additionalInfo?: any;
}) {
  globalSolanaRpcEndpoint = rpcEndpoint;
  lightProtocolRpc = createRpc(
    globalSolanaRpcEndpoint,
    compressionApiEndpoint,
    proverEndpoint
  );
  const { rpc, rpcSubscriptions, sendAndConfirmTransaction } =
    createSolanaClient({
      urlOrMoniker: globalSolanaRpcEndpoint,
    });
  globalSolanaRpc = rpc;
  globalSolanaRpcSubscription = rpcSubscriptions;
  globalSendAndConfirmTransaction = sendAndConfirmTransaction;
  globalComputeBudgetEstimate = estimateComputeUnitLimitFactory({
    rpc,
  });
  const getBlockHeightExceedencePromise =
    createBlockHeightExceedencePromiseFactory({
      rpc,
      rpcSubscriptions,
    });
  const getRecentSignatureConfirmationPromise =
    createRecentSignatureConfirmationPromiseFactory({
      rpc,
      rpcSubscriptions,
    });
  globalConfirmRecentTransaction = async (config: {
    signature: Signature;
    lastValidBlockHeight: bigint;
    commitment: Commitment;
  }) => {
    const { commitment, signature, lastValidBlockHeight } = config;
    const abortController = new AbortController();
    try {
      return await safeRace([
        getRecentSignatureConfirmationPromise({
          abortSignal: abortController.signal,
          commitment,
          signature,
        }),
        getBlockHeightExceedencePromise({
          abortSignal: abortController.signal,
          commitment,
          lastValidBlockHeight,
        }),
      ]);
    } finally {
      abortController.abort();
    }
  };

  globalPayerEndpoint = payerEndpoint ?? null;
  globalJitoTipsConfig = jitoTipsConfig ?? null;
  globalAuthUrl = authUrl ?? null;
  globalExpectedOrigin = expectedOrigin ?? null;
  globalExpectedRPID = expectedRPID ?? null;

  if (typeof window !== "undefined") {
    registerWallet(
      new RevibaseWallet(
        createRevibaseAdapter({ authorizedClients, additionalInfo })
      )
    );
  }
}
