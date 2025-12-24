import { initialize, type JitoTipsConfig } from "@revibase/core";
import { registerWallet } from "@wallet-standard/core";
import type { TransactionSigner } from "gill";
import type { ClientAuthorizationCallback } from "../utils/types";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

interface InitializeWalletArgs {
  rpcEndpoint: string;
  proverEndpoint?: string;
  compressionApiEndpoint?: string;
  jitoTipsConfig?: JitoTipsConfig;
  onClientAuthorizationCallback: ClientAuthorizationCallback;
  authOrigin?: string;
  feePayer?: TransactionSigner;
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
