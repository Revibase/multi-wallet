import {
  createRpc,
  Rpc as LightProtocolRpc,
} from "@lightprotocol/stateless.js";
import {
  createSolanaClient,
  type Rpc,
  type SendAndConfirmTransactionWithSignersFunction,
  type SolanaRpcApi,
} from "gill";
import {
  DEFAULT_JITO_BLOCK_ENGINE_URL,
  DEFAULT_JITO_TIP_PRIORITY,
  DEFAULT_JITO_TIPS_URL,
} from "../constants";
import { NotInitializedError } from "../errors";
import type { JitoTipsConfig } from "../types";

type RevibaseGlobalState = {
  solanaRpcEndpoint?: string;
  lightProtocolRpc?: LightProtocolRpc;
  solanaRpc?: Rpc<SolanaRpcApi>;
  sendAndConfirm?: SendAndConfirmTransactionWithSignersFunction;
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

export function getJitoTipsConfig() {
  if (!state.jitoTipsConfig) {
    return {
      blockEngineUrl: DEFAULT_JITO_BLOCK_ENGINE_URL,
      getJitoTipsUrl: DEFAULT_JITO_TIPS_URL,
      priority: DEFAULT_JITO_TIP_PRIORITY,
    };
  }

  return state.jitoTipsConfig;
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
}): void {
  state.solanaRpcEndpoint = rpcEndpoint;
  state.lightProtocolRpc = createRpc(
    rpcEndpoint,
    compressionApiEndpoint,
    proverEndpoint,
  );
  const { rpc, sendAndConfirmTransaction } = createSolanaClient({
    urlOrMoniker: rpcEndpoint,
  });
  state.solanaRpc = rpc;
  state.sendAndConfirm = sendAndConfirmTransaction;
  state.jitoTipsConfig = jitoTipsConfig ?? null;
}
