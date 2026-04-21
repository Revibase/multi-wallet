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
import { NotInitializedError } from "../errors";

type RevibaseGlobalState = {
  solanaRpcEndpoint?: string;
  lightProtocolRpc?: LightProtocolRpc;
  solanaRpc?: Rpc<SolanaRpcApi>;
  sendAndConfirm?: SendAndConfirmTransactionWithSignersFunction;
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

export function initialize({
  rpcEndpoint,
  proverEndpoint,
  compressionApiEndpoint,
}: {
  rpcEndpoint: string;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
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
}
