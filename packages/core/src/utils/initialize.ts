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
import {
  DEFAULT_JITO_BLOCK_ENGINE_URL,
  DEFAULT_JITO_TIPS_URL,
  DEFAULT_PRIORITY_LVL,
} from "../constants";
import { NotInitializedError } from "../errors";
import type { JitoTipsConfig } from "../types";

featureFlags.version = VERSION.V2;

type RevibaseGlobalState = {
  solanaRpcEndpoint?: string;
  lightProtocolRpc?: LightProtocolRpc;
  solanaRpc?: Rpc<SolanaRpcApi>;
  sendAndConfirm?: SendAndConfirmTransactionWithSignersFunction;
  computeEstimate?: (
    tx: BaseTransactionMessage & TransactionMessageWithFeePayer,
    cfg?: { commitment?: "processed" | "confirmed" | "finalized" }
  ) => Promise<number>;
  jitoTipsConfig?: JitoTipsConfig | null;
};

const state: RevibaseGlobalState = {};

export function getSolanaRpcEndpoint() {
  if (!state.solanaRpcEndpoint) {
    throw new NotInitializedError("RPC endpoint");
  }
  return state.solanaRpcEndpoint;
}

export function getLightProtocolRpc() {
  if (!state.lightProtocolRpc) {
    throw new NotInitializedError("Light Protocol RPC");
  }
  return state.lightProtocolRpc;
}

export function getSolanaRpc() {
  if (!state.solanaRpc) {
    throw new NotInitializedError("Solana RPC");
  }
  return state.solanaRpc;
}

export function getSendAndConfirmTransaction() {
  if (!state.sendAndConfirm) {
    throw new NotInitializedError("Send and confirm transaction function");
  }
  return state.sendAndConfirm;
}

export function getComputeBudgetEstimate() {
  if (!state.computeEstimate) {
    throw new NotInitializedError("Compute budget estimate function");
  }
  return state.computeEstimate;
}

export function getJitoTipsConfig() {
  if (!state.jitoTipsConfig) {
    return {
      blockEngineUrl: DEFAULT_JITO_BLOCK_ENGINE_URL,
      getJitoTipsUrl: DEFAULT_JITO_TIPS_URL,
      priority: DEFAULT_PRIORITY_LVL,
    };
  }

  return state.jitoTipsConfig;
}

/**
 * Initializes the SDK with RPC endpoints and configuration
 * @param rpcEndpoint - Solana RPC endpoint URL
 * @param proverEndpoint - Optional prover endpoint URL
 * @param compressionApiEndpoint - Optional compression API endpoint URL
 * @param jitoTipsConfig - Optional Jito tips configuration
 */
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
}): void {
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
