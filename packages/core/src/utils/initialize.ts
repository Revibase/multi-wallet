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
import type { ClientAuthorizationCallback, JitoTipsConfig } from "../types";
import {
  REVIBASE_API_ENDPOINT,
  REVIBASE_AUTH_ENDPOINT,
  REVIBASE_RP_ID,
} from "./consts";
import { getRandomPayer } from "./transaction/internal";

type RevibaseGlobalState = {
  solanaRpcEndpoint?: string;
  lightProtocolRpc?: LightProtocolRpc;
  solanaRpc?: Rpc<SolanaRpcApi>;
  sendAndConfirm?: SendAndConfirmTransactionWithSignersFunction;
  computeEstimate?: (
    tx: BaseTransactionMessage & TransactionMessageWithFeePayer,
    cfg?: any
  ) => Promise<number>;
  feePayer?: TransactionSigner;
  apiEndpoint?: string | null;
  jitoTipsConfig?: JitoTipsConfig | null;
  authEndpoint?: string | null;
  rpId?: string | null;
  onClientAuthorizationCallback?: ClientAuthorizationCallback | null;
};

const state: RevibaseGlobalState = {};

export function getSolanaRpcEndpoint() {
  if (!state.solanaRpcEndpoint) throw new Error("Rpc is not initialized yet.");
  return state.solanaRpcEndpoint;
}

export function getLightProtocolRpc() {
  if (!state.lightProtocolRpc) throw new Error("Rpc is not initialized yet");
  return state.lightProtocolRpc;
}

export function getSolanaRpc() {
  if (!state.solanaRpc) throw new Error("Rpc is not initialized yet");
  return state.solanaRpc;
}

export function getSendAndConfirmTransaction() {
  if (!state.sendAndConfirm) throw new Error("Rpc is not initialized yet.");
  return state.sendAndConfirm;
}

export function getComputeBudgetEstimate() {
  if (!state.computeEstimate) throw new Error("Rpc is not initialized yet");
  return state.computeEstimate;
}

export async function getFeePayer() {
  if (!state.feePayer) {
    state.feePayer = await getRandomPayer(
      state.apiEndpoint ?? REVIBASE_API_ENDPOINT
    );
  }
  return state.feePayer;
}

export function getJitoTipsConfig() {
  if (!state.jitoTipsConfig) throw new Error("Jito Bundle Config is not set.");
  return state.jitoTipsConfig;
}

export function getAuthEndpoint() {
  return state.authEndpoint ?? REVIBASE_AUTH_ENDPOINT;
}

export function getRpId() {
  return state.rpId ?? REVIBASE_RP_ID;
}

export function getOnClientAuthorizationCallback() {
  if (!state.onClientAuthorizationCallback)
    throw new Error("No client authorization callback found.");
  return state.onClientAuthorizationCallback;
}

export function uninitialize() {
  Object.keys(state).forEach((key) => {
    (state as any)[key] = undefined;
  });
}

export function initialize({
  rpcEndpoint,
  proverEndpoint,
  compressionApiEndpoint,
  jitoTipsConfig,
  apiEndpoint,
  authEndpoint,
  rpId,
  onClientTransactionCallback,
}: {
  rpcEndpoint: string;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  apiEndpoint?: string;
  authEndpoint?: string;
  rpId?: string;
  onClientTransactionCallback?: ClientAuthorizationCallback;
}) {
  state.solanaRpcEndpoint = rpcEndpoint;

  state.lightProtocolRpc = createRpc(
    rpcEndpoint,
    compressionApiEndpoint,
    proverEndpoint
  );

  const { rpc, sendAndConfirmTransaction } = createSolanaClient({
    urlOrMoniker: rpcEndpoint,
  });

  state.solanaRpc = rpc;
  state.sendAndConfirm = sendAndConfirmTransaction;
  state.computeEstimate = estimateComputeUnitLimitFactory({ rpc });

  state.apiEndpoint = apiEndpoint ?? null;
  state.jitoTipsConfig = jitoTipsConfig ?? null;
  state.authEndpoint = authEndpoint ?? null;
  state.rpId = rpId ?? null;
  state.onClientAuthorizationCallback = onClientTransactionCallback ?? null;
}
