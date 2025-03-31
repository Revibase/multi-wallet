import { PublicKey } from "@solana/web3.js";

export interface DomainConfig {
  rpIdHash: number[];
  originLength: number;
  origin: number[];
  bump: number;
  authority: PublicKey;
  padding: number[];
}
