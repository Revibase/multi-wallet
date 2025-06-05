import { TransactionSigner } from "@solana/kit";
import { registerWallet } from "@wallet-standard/core";
import { createRevibaseAdapter } from "./core";
import { RevibaseWallet } from "./wallet";

export function initializeAdapter(rpcEndpoint: string, feePayer?: TransactionSigner) {
  registerWallet(new RevibaseWallet(createRevibaseAdapter(rpcEndpoint, feePayer)));
}
