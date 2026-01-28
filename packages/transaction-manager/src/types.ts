import type { Instruction, ReadonlyUint8Array } from "gill";

export interface TransactionManagerConfig {
  publicKey: string;
  url: string;
}

export interface SignerInfo {
  signer: string;
  messageHash: Uint8Array<ArrayBuffer>;
}

export interface Secp256r1VerifyData {
  instructionIndex: number;
  data?: ReadonlyUint8Array;
}

export interface ProcessingResult {
  settingsAddress: string;
  signers: SignerInfo[];
  instructionsToVerify: Instruction[];
}

export interface ClientDataJSON {
  challenge: string;
  origin: string;
  type: string;
}

export interface WellKnownCacheEntry {
  publicKey: JsonWebKey;
  timestamp: number;
}
