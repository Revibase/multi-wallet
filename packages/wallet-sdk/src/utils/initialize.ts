import {
  createRpc,
  Rpc as LightProtocolRpc,
} from "@lightprotocol/stateless.js";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  Rpc,
  RpcSubscriptions,
  SolanaRpcApi,
  SolanaRpcSubscriptionsApi,
  TransactionSigner,
} from "@solana/kit";
import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "../adapter/core";
import { RevibaseWallet } from "../adapter/wallet";

let lightProtocolRpc: LightProtocolRpc | null = null;
let rpc: Rpc<SolanaRpcApi> | null = null;
let rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi> | null = null;

export function getLightProtocolRpc() {
  if (!lightProtocolRpc) {
    throw new Error("Rpc not initialized yet");
  }
  return lightProtocolRpc;
}

export function getSolanaRpc() {
  if (!rpc) {
    throw new Error("Rpc not initialized yet");
  }
  return rpc;
}

export function getSolanaRpcSubscriptions() {
  if (!rpcSubscriptions) {
    throw new Error("Rpc not initialized yet");
  }
  return rpcSubscriptions;
}

export function initializeMultiWallet({
  rpcEndpoint,
  compressionApiEndpoint,
  proverEndpoint,
  payer,
  estimateJitoTipEndpoint = `https://proxy.revibase.com/?url=https://bundles.jito.wtf/api/v1/bundles/tip_floor`,
  jitoBlockEngineEndpoint = `https://mainnet.block-engine.jito.wtf/api/v1`,
}: {
  rpcEndpoint: string;
  compressionApiEndpoint?: string;
  proverEndpoint?: string;
  payer?: TransactionSigner;
  estimateJitoTipEndpoint?: string;
  jitoBlockEngineEndpoint?: string;
}) {
  rpc = createSolanaRpc(rpcEndpoint);
  lightProtocolRpc = createRpc(
    rpcEndpoint,
    compressionApiEndpoint,
    proverEndpoint
  );
  rpcSubscriptions = createSolanaRpcSubscriptions(
    "wss://" + new URL(rpcEndpoint).hostname
  );
  if (typeof window !== "undefined") {
    registerWallet(
      new RevibaseWallet(
        createRevibaseAdapter({
          payer,
          jitoBlockEngineEndpoint,
          estimateJitoTipEndpoint,
        })
      )
    );
  }
}
