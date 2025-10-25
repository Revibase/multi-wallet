import {
  createRpc,
  Rpc as LightProtocolRpc,
} from "@lightprotocol/stateless.js";
import { registerWallet } from "@wallet-standard/core";
import {
  createSolanaClient,
  type CompilableTransactionMessage,
  type Rpc,
  type SendAndConfirmTransactionWithSignersFunction,
  type SolanaRpcApi,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionSigner,
} from "gill";
import { estimateComputeUnitLimitFactory } from "gill/programs";
import { createRevibaseAdapter } from "../adapter/core";
import { RevibaseWallet } from "../adapter/wallet";
import type { JitoTipsConfig } from "../types";
import { REVIBASE_API_ENDPOINT, REVIBASE_AUTH_DOMAIN } from "./consts";
import { getRandomPayer } from "./internal";

let globalSolanaRpcEndpoint: string | null = null;
let lightProtocolRpc: LightProtocolRpc | null = null;
let globalSolanaRpc: Rpc<SolanaRpcApi> | null = null;
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

let globalFeePayer: TransactionSigner | null = null;
let globalPayerEndpoint: string | null = null;
let globalJitoTipsConfig: JitoTipsConfig | null = null;
let globalAuthUrl: string | null = null;
let globalAuthorizedClient: { publicKey: string; url: string } | null = null;
let globalAdditionalInfo: any | null = null;

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

export async function getFeePayer() {
  if (!globalFeePayer) {
    globalFeePayer = await getRandomPayer(
      globalPayerEndpoint ?? REVIBASE_API_ENDPOINT
    );
  }
  return globalFeePayer;
}

export function getJitoTipsConfig() {
  if (!globalJitoTipsConfig) throw new Error("Jito Bundle Config is not set.");
  return globalJitoTipsConfig;
}

export function getAuthUrl() {
  return globalAuthUrl ?? REVIBASE_AUTH_DOMAIN;
}

export function getGlobalAuthorizedClient() {
  return globalAuthorizedClient;
}

export function getGlobalAdditonalInfo() {
  return globalAdditionalInfo;
}

export function uninitializeMultiWallet() {
  lightProtocolRpc = null;
  globalSolanaRpc = null;
  globalSolanaRpcEndpoint = null;
  globalFeePayer = null;
  globalPayerEndpoint = null;
  globalJitoTipsConfig = null;
  globalAuthUrl = null;
  globalSendAndConfirmTransaction = null;
  globalComputeBudgetEstimate = null;
  globalAuthorizedClient = null;
}

export function initializeMultiWallet({
  rpcEndpoint,
  payerEndpoint,
  jitoTipsConfig,
  compressionApiEndpoint,
  proverEndpoint,
  authUrl,
  authorizedClients,
  additionalInfo,
}: {
  rpcEndpoint: string;
  payerEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  compressionApiEndpoint?: string;
  proverEndpoint?: string;
  authUrl?: string;
  authorizedClients?: { publicKey: string; url: string };
  additionalInfo?: any;
}) {
  globalSolanaRpcEndpoint = rpcEndpoint;
  lightProtocolRpc = createRpc(
    globalSolanaRpcEndpoint,
    compressionApiEndpoint,
    proverEndpoint
  );
  const { rpc, sendAndConfirmTransaction } = createSolanaClient({
    urlOrMoniker: globalSolanaRpcEndpoint,
  });
  globalSolanaRpc = rpc;
  globalSendAndConfirmTransaction = sendAndConfirmTransaction;
  globalComputeBudgetEstimate = estimateComputeUnitLimitFactory({
    rpc,
  });

  globalPayerEndpoint = payerEndpoint ?? null;
  globalJitoTipsConfig = jitoTipsConfig ?? null;
  globalAuthUrl = authUrl ?? null;
  globalAuthorizedClient = authorizedClients ?? null;
  globalAdditionalInfo = additionalInfo ?? null;

  if (typeof window !== "undefined") {
    registerWallet(new RevibaseWallet(createRevibaseAdapter()));
  }
}
