import {
  initialize,
  type ClientAuthorizationCallback,
  type JitoTipsConfig,
} from "@revibase/core";
import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

interface InitializeWalletArgs {
  rpcEndpoint: string;
  onClientAuthorizationCallback: ClientAuthorizationCallback;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  authEndpoint?: string;
  apiEndpoint?: string;
}

export function initializeWallet(input: InitializeWalletArgs) {
  initialize({
    rpcEndpoint: input.rpcEndpoint,
    onClientAuthorizationCallback: input.onClientAuthorizationCallback,
    proverEndpoint: input.proverEndpoint,
    compressionApiEndpoint: input.compressionApiEndpoint,
    jitoTipsConfig: input.jitoTipsConfig,
    authEndpoint: input.authEndpoint,
    apiEndpoint: input.apiEndpoint,
  });
  if (typeof window !== "undefined") {
    registerWallet(new RevibaseWallet(createRevibaseAdapter()));
  }
}
