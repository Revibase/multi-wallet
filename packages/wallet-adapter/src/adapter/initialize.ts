import { initialize, type JitoTipsConfig } from "@revibase/core";
import { registerWallet } from "@wallet-standard/core";
import type { TransactionSigner } from "gill";
import { RevibaseProvider } from "src/provider";
import type { ClientAuthorizationCallback } from "../utils/types";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

/**
 * Configuration options for initializing the Revibase wallet adapter
 */
export interface InitializeWalletArgs {
  /** RPC endpoint URL for Solana network connection */
  rpcEndpoint: string;
  /** Optional prover endpoint URL */
  proverEndpoint?: string;
  /** Optional compression API endpoint URL */
  compressionApiEndpoint?: string;
  /** Optional Jito tips configuration */
  jitoTipsConfig?: JitoTipsConfig;
  /** Callback function for handling client authorization requests */
  onClientAuthorizationCallback: ClientAuthorizationCallback;
  /** Optional origin URL for the authentication provider */
  providerOrigin?: string;
  /** Optional transaction signer to use as fee payer */
  feePayer?: TransactionSigner;
}

/**
 * Initializes the Revibase wallet adapter and registers it with the wallet standard.
 *
 * This function should be called once during application startup to set up the wallet.
 * It initializes the core SDK and registers the wallet adapter for browser environments.
 *
 * @param input - Configuration options for wallet initialization
 *
 * @example
 * ```ts
 * initializeWallet({
 *   rpcEndpoint: "https://api.mainnet-beta.solana.com",
 *   onClientAuthorizationCallback: async (request) => {
 *     // Handle authorization
 *   }
 * });
 * ```
 */
export function initializeWallet(input: InitializeWalletArgs): void {
  initialize({
    rpcEndpoint: input.rpcEndpoint,
    proverEndpoint: input.proverEndpoint,
    compressionApiEndpoint: input.compressionApiEndpoint,
    jitoTipsConfig: input.jitoTipsConfig,
  });

  if (typeof window !== "undefined") {
    const provider = new RevibaseProvider({
      onClientAuthorizationCallback: input.onClientAuthorizationCallback,
      providerOrigin: input.providerOrigin,
    });
    registerWallet(
      new RevibaseWallet(createRevibaseAdapter(provider, input.feePayer))
    );
  }
}
