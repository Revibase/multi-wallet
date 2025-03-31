import { PublicKey } from "@solana/web3.js";

export interface Delegate {
  multiWalletSettings: PublicKey;
  multiWallet: PublicKey;
  bump: number;
}
