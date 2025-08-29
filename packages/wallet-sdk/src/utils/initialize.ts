import {
  createRpc,
  Rpc as LightProtocolRpc,
} from "@lightprotocol/stateless.js";
import {
  createSolanaRpc,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "../adapter/core";
import { getRandomPayer, JitoTipsConfig } from "../adapter/util";
import { RevibaseWallet } from "../adapter/wallet";

let lightProtocolRpc: LightProtocolRpc | null = null;
let rpc: Rpc<SolanaRpcApi> | null = null;
let feePayer: TransactionSigner | null = null;

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

export function getFeePayer() {
  if (!feePayer) {
    throw new Error("Payer not initialized yet");
  }
  return feePayer;
}

export function initializeMultiWallet({
  jitoTipsConfig,
  rpcEndpoint,
  compressionApiEndpoint,
  proverEndpoint,
  payer,
  authUrl,
  expectedOrigin,
  expectedRPID,
}: {
  jitoTipsConfig: JitoTipsConfig;
  rpcEndpoint: string;
  payer?: TransactionSigner;
  compressionApiEndpoint?: string;
  proverEndpoint?: string;
  authUrl?: string;
  expectedOrigin?: string;
  expectedRPID?: string;
}) {
  rpc = createSolanaRpc(rpcEndpoint);
  lightProtocolRpc = createRpc(
    rpcEndpoint,
    compressionApiEndpoint,
    proverEndpoint
  );
  if (!payer) {
    getRandomPayer().then((result) => {
      feePayer = result;
    });
  } else {
    feePayer = payer;
  }
  if (typeof window !== "undefined") {
    registerWallet(
      new RevibaseWallet(
        createRevibaseAdapter({
          jitoTipsConfig,
          authUrl,
          expectedOrigin,
          expectedRPID,
        })
      )
    );
  }
}
