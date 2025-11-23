import {
  createRpc,
  Rpc as LightProtocolRpc,
} from "@lightprotocol/stateless.js";
import {
  createSolanaClient,
  type BaseTransactionMessage,
  type Rpc,
  type SendAndConfirmTransactionWithSignersFunction,
  type SolanaRpcApi,
  type TransactionMessageWithFeePayer,
  type TransactionSigner,
} from "gill";
import { estimateComputeUnitLimitFactory } from "gill/programs";
import type { JitoTipsConfig } from "../types";
import {
  REVIBASE_API_ENDPOINT,
  REVIBASE_AUTH_ENDPOINT,
  REVIBASE_RP_ID,
} from "./consts";
import { getRandomPayer } from "./transaction/internal";

let globalSolanaRpcEndpoint: string | null = null;
let lightProtocolRpc: LightProtocolRpc | null = null;
let globalSolanaRpc: Rpc<SolanaRpcApi> | null = null;
let globalSendAndConfirmTransaction: SendAndConfirmTransactionWithSignersFunction | null =
  null;
let globalComputeBudgetEstimate:
  | ((
      transactionMessage: BaseTransactionMessage &
        TransactionMessageWithFeePayer,
      config?: any
    ) => Promise<number>)
  | null;

let globalFeePayer: TransactionSigner | null = null;
let globalApiEndpoint: string | null = null;
let globalJitoTipsConfig: JitoTipsConfig | null = null;
let globalAuthEndpoint: string | null = null;
let globalRpId: string | null = null;
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
      globalApiEndpoint ?? REVIBASE_API_ENDPOINT
    );
  }
  return globalFeePayer;
}

export function getJitoTipsConfig() {
  if (!globalJitoTipsConfig) throw new Error("Jito Bundle Config is not set.");
  return globalJitoTipsConfig;
}

export function getAuthEndpoint() {
  return globalAuthEndpoint ?? REVIBASE_AUTH_ENDPOINT;
}

export function getRpId() {
  return globalRpId ?? REVIBASE_RP_ID;
}

export function getGlobalAdditonalInfo() {
  return globalAdditionalInfo;
}

export function uninitialize() {
  lightProtocolRpc = null;
  globalSolanaRpc = null;
  globalSolanaRpcEndpoint = null;
  globalFeePayer = null;
  globalApiEndpoint = null;
  globalJitoTipsConfig = null;
  globalAuthEndpoint = null;
  globalRpId = null;
  globalSendAndConfirmTransaction = null;
  globalComputeBudgetEstimate = null;
}

export function initialize({
  rpcEndpoint,
  proverEndpoint,
  compressionApiEndpoint,
  jitoTipsConfig,
  apiEndpoint,
  authEndpoint,
  rpId,
  additionalInfo,
}: {
  rpcEndpoint: string;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  apiEndpoint?: string;
  authEndpoint?: string;
  rpId?: string;
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
  globalSendAndConfirmTransaction = sendAndConfirmTransaction;
  globalComputeBudgetEstimate = estimateComputeUnitLimitFactory({
    rpc,
  });

  globalSolanaRpc = rpc;
  globalApiEndpoint = apiEndpoint ?? null;
  globalJitoTipsConfig = jitoTipsConfig ?? null;
  globalAuthEndpoint = authEndpoint ?? null;
  globalRpId = rpId ?? null;
  globalAdditionalInfo = additionalInfo ?? null;
}
