import {
  createRpc,
  Rpc as LightProtocolRpc,
} from "@lightprotocol/stateless.js";
import {
  createBlockHeightExceedencePromiseFactory,
  createRecentSignatureConfirmationPromiseFactory,
  waitForRecentTransactionConfirmation,
} from "@solana/transaction-confirmation";
import { registerWallet } from "@wallet-standard/core";
import {
  type CompilableTransactionMessage,
  createSolanaClient,
  type Rpc,
  type RpcSubscriptions,
  type SendAndConfirmTransactionWithSignersFunction,
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

let globalSolanaRpcEndpoint: string | undefined;

let lightProtocolRpc: LightProtocolRpc | undefined;
let globalSolanaRpc: Rpc<SolanaRpcApi> | undefined;
let globalSolanaRpcSubscription:
  | (RpcSubscriptions<SolanaRpcSubscriptionsApi> & string)
  | undefined;
let globalSendAndConfirmTransaction:
  | SendAndConfirmTransactionWithSignersFunction
  | undefined;

let globalComputeBudgetEstimate:
  | ((
      transactionMessage:
        | CompilableTransactionMessage
        | (TransactionMessage & TransactionMessageWithFeePayer),
      config?: any
    ) => Promise<number>)
  | undefined;
let globalConfirmRecentTransaction: (config: any) => Promise<void>;

let globalFeePayer: TransactionSigner | undefined;
let globalPayerEndpoint: string | undefined;
let globalJitoTipsConfig: JitoTipsConfig | undefined;
let globalAuthUrl: string | undefined;
let globalExpectedOrigin: string | undefined;
let globalExpectedRPID: string | undefined;

export function getSolanaRpcEndpoint() {
  if (!globalSolanaRpcEndpoint) throw new Error("Rpc is not initialized yet.");
  return globalSolanaRpcEndpoint;
}

export function getLightProtocolRpc() {
  if (!lightProtocolRpc) throw new Error("Rpc not initialized yet");
  return lightProtocolRpc;
}

export function getSolanaRpc() {
  if (!globalSolanaRpc) throw new Error("Rpc not initialized yet");
  return globalSolanaRpc;
}

export function getSolanaRpcSubscription() {
  if (!globalSolanaRpcSubscription)
    throw new Error("Rpc is not initiazlied yet.");
  return globalSolanaRpcSubscription;
}

export function getSendAndConfirmTransaction() {
  if (!globalSendAndConfirmTransaction)
    throw new Error("Rpc not initialized yet.");
  return globalSendAndConfirmTransaction;
}

export function getComputeBudgetEstimate() {
  if (!globalComputeBudgetEstimate) throw new Error("Rpc not initialized yet");
  return globalComputeBudgetEstimate;
}

export function getConfirmRecentTransaction() {
  if (!globalConfirmRecentTransaction)
    throw new Error("Rpc not initialized yet.");
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
  return {
    jitoBlockEngineUrl: "https://mainnet.block-engine.jito.wtf/api/v1",
    priority: "ema_landed_tips_50th_percentile",
    estimateJitoTipsEndpoint: `https://proxy.revibase.com?url=${encodeURIComponent("https://bundles.jito.wtf/api/v1/bundles/tip_floor")}`,
    ...globalJitoTipsConfig,
  };
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
  lightProtocolRpc = undefined;
  globalSolanaRpc = undefined;
  globalSolanaRpcEndpoint = undefined;
  globalFeePayer = undefined;
  globalPayerEndpoint = undefined;
  globalJitoTipsConfig = undefined;
  globalAuthUrl = undefined;
  globalExpectedOrigin = undefined;
  globalExpectedRPID = undefined;
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
}: {
  rpcEndpoint: string;
  payerEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  compressionApiEndpoint?: string;
  proverEndpoint?: string;
  authUrl?: string;
  expectedOrigin?: string;
  expectedRPID?: string;
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
  globalConfirmRecentTransaction = (config: any) => {
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
    return waitForRecentTransactionConfirmation({
      ...config,
      getBlockHeightExceedencePromise,
      getRecentSignatureConfirmationPromise,
    });
  };

  globalPayerEndpoint = payerEndpoint;
  globalJitoTipsConfig = jitoTipsConfig;
  globalAuthUrl = authUrl;
  globalExpectedOrigin = expectedOrigin;
  globalExpectedRPID = expectedRPID;

  if (typeof window !== "undefined") {
    registerWallet(new RevibaseWallet(createRevibaseAdapter()));
  }
}
