import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

export function initializeAdapter(rpcEndpoint: string) {
  registerWallet(new RevibaseWallet(createRevibaseAdapter(rpcEndpoint)));
}
