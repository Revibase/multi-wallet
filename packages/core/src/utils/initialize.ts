import { type Rpc, type SolanaRpcApi } from "@solana/kit";
import { createSolanaRpc } from "@solana/rpc";
import { NotInitializedError } from "../errors";

type RevibaseGlobalState = {
  solanaRpcEndpoint?: string;
  solanaRpc?: Rpc<SolanaRpcApi>;
};

const state: RevibaseGlobalState = {};

export function getSolanaRpcEndpoint() {
  if (!state.solanaRpcEndpoint) {
    throw new NotInitializedError("RPC endpoint");
  }
  return state.solanaRpcEndpoint;
}

export function getSolanaRpc() {
  if (!state.solanaRpc) {
    throw new NotInitializedError("Solana RPC");
  }
  return state.solanaRpc;
}

export function initialize({
  rpcEndpoint,
}: {
  rpcEndpoint: string;
}): void {
  state.solanaRpcEndpoint = rpcEndpoint;
  const rpc = createSolanaRpc(rpcEndpoint);
  state.solanaRpc = rpc;
}
