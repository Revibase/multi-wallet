import {
  createRpc,
  featureFlags,
  Rpc as LightProtocolRpc,
  VERSION,
} from "@lightprotocol/stateless.js";
import {
  createSolanaClient,
  type BaseTransactionMessage,
  type Rpc,
  type SendAndConfirmTransactionWithSignersFunction,
  type SolanaRpcApi,
  type TransactionMessageWithFeePayer,
} from "gill";
import { estimateComputeUnitLimitFactory } from "gill/programs";
import type { JitoTipsConfig } from "../types";

featureFlags.version = VERSION.V2;

type RevibaseGlobalState = {
  solanaRpcEndpoint?: string;
  lightProtocolRpc?: LightProtocolRpc;
  solanaRpc?: Rpc<SolanaRpcApi>;
  sendAndConfirm?: SendAndConfirmTransactionWithSignersFunction;
  computeEstimate?: (
    tx: BaseTransactionMessage & TransactionMessageWithFeePayer,
    cfg?: any
  ) => Promise<number>;
  jitoTipsConfig?: JitoTipsConfig | null;
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

export function getJitoTipsConfig() {
  if (!state.jitoTipsConfig) {
    return {
      blockEngineUrl: "https://mainnet.block-engine.jito.wtf/api/v1",
      getJitoTipsUrl: "https://bundles.jito.wtf/api/v1/bundles/tip_floor",
      priority: "landed_tips_75th_percentile",
    };
  }

  return state.jitoTipsConfig;
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
}: {
  rpcEndpoint: string;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
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
  state.jitoTipsConfig = jitoTipsConfig ?? null;
}
