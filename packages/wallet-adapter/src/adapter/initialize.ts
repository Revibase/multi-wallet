import type { SignClientMessage } from "@revibase/core";
import { initialize, type JitoTipsConfig } from "@revibase/core";
import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

interface InitializeWalletArgs {
  rpcEndpoint: string;
  clientSettings: {
    clientId: string;
    signClientMessage: SignClientMessage;
  };
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
}

export function initializeWallet(input: InitializeWalletArgs) {
  initialize(input);
  if (typeof window !== "undefined") {
    registerWallet(new RevibaseWallet(createRevibaseAdapter()));
  }
}
