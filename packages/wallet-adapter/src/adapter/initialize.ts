import { initialize, type JitoTipsConfig } from "@revibase/core";
import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

interface InitializeWalletArgs {
  rpcEndpoint: string;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  authorizedClient?: {
    publicKey: string;
    url: string;
  };
}

export function initializeWallet(input: InitializeWalletArgs) {
  initialize(input);
  if (typeof window !== "undefined") {
    registerWallet(new RevibaseWallet(createRevibaseAdapter()));
  }
}
