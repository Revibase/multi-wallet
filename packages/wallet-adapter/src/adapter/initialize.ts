import {
  initialize,
  type ClientAuthorizationCallback,
  type JitoTipsConfig,
} from "@revibase/core";
import { registerWallet } from "@wallet-standard/core";
import type { TransactionSigner } from "gill";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

interface InitializeWalletArgs {
  rpcEndpoint: string;
  onClientAuthorizationCallback: ClientAuthorizationCallback;
  authOrigin?: string;
  feePayer?: TransactionSigner;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
}

export function initializeWallet(input: InitializeWalletArgs) {
  initialize({
    rpcEndpoint: input.rpcEndpoint,
    proverEndpoint: input.proverEndpoint,
    compressionApiEndpoint: input.compressionApiEndpoint,
    jitoTipsConfig: input.jitoTipsConfig,
  });
  if (typeof window !== "undefined") {
    registerWallet(
      new RevibaseWallet(
        createRevibaseAdapter(
          input.onClientAuthorizationCallback,
          input.feePayer,
          input.authOrigin
        )
      )
    );
  }
}
