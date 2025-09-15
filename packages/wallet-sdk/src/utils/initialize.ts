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
import { RevibaseWallet } from "../adapter/wallet";
import { JitoTipsConfig } from "../types";
import { getRandomPayer } from "./helper";

let lightProtocolRpc: LightProtocolRpc | undefined;
let solanaRpc: Rpc<SolanaRpcApi> | undefined;
let globalFeePayer: TransactionSigner | undefined;
let globalPayerEndpoint: string | undefined;
let globalJitoTipsConfig: JitoTipsConfig | undefined;
let globalAuthUrl: string | undefined;
let globalExpectedOrigin: string | undefined;
let globalExpectedRPID: string | undefined;

export function getLightProtocolRpc() {
  if (!lightProtocolRpc) throw new Error("Rpc not initialized yet");
  return lightProtocolRpc;
}

export function getSolanaRpc() {
  if (!solanaRpc) throw new Error("Rpc not initialized yet");
  return solanaRpc;
}

export async function getFeePayer() {
  if (!globalFeePayer) {
    globalFeePayer = await getRandomPayer(
      globalPayerEndpoint ?? "https://api.revibase.com"
    );
  }
  return globalFeePayer;
}

export function getJitoTipsConfig() {
  if (!globalJitoTipsConfig)
    throw new Error("Jito Tips Configuration is not initialized yet");
  return globalJitoTipsConfig;
}

export function getAuthUrl() {
  return globalAuthUrl ?? "https://auth.revibase.com";
}

export function getExpectedOrigin() {
  return globalExpectedOrigin ?? "https://auth.revibase.com";
}

export function getExpectedRPID() {
  return globalExpectedRPID ?? "revibase.com";
}

export function initializeMultiWallet({
  rpcEndpoint,
  payerEndpoint,
  jitoTipsConfig,
  compressionApiEndpoint,
  proverEndpoint,
  authUrl,
  expectedOrigin,
  expectedRPID,
}: {
  rpcEndpoint: string;
  payerEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  compressionApiEndpoint?: string;
  proverEndpoint?: string;
  authUrl?: string;
  expectedOrigin?: string;
  expectedRPID?: string;
}) {
  solanaRpc = createSolanaRpc(rpcEndpoint);
  lightProtocolRpc = createRpc(
    rpcEndpoint,
    compressionApiEndpoint,
    proverEndpoint
  );

  globalPayerEndpoint = payerEndpoint;
  globalJitoTipsConfig = jitoTipsConfig;
  globalAuthUrl = authUrl;
  globalExpectedOrigin = expectedOrigin;
  globalExpectedRPID = expectedRPID;

  if (typeof window !== "undefined") {
    registerWallet(new RevibaseWallet(createRevibaseAdapter()));
  }
}
