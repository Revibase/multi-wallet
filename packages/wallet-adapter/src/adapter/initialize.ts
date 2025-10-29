import { initialize, type JitoTipsConfig } from "@revibase/core";
import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

export function initializeWallet(input: {
  rpcEndpoint: string;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  authorizedClient?: { publicKey: string; url: string };
  additionalInfo?: any;
}) {
  initialize(input);
  if (typeof window !== "undefined") {
    registerWallet(new RevibaseWallet(createRevibaseAdapter()));
  }
}
