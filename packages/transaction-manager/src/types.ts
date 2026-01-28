import type { Instruction, ReadonlyUint8Array } from "gill";

/**
 * Configuration for the Transaction Manager service.
 */
export interface TransactionManagerConfig {
  /** The public key (base58-encoded) of the transaction manager. */
  publicKey: string;
  /** The URL endpoint where the transaction manager service is hosted. */
  url: string;
}

/**
 * Information about a signer extracted from a secp256r1 verification instruction.
 */
export interface SignerInfo {
  /** The public key (string representation) of the signer. */
  signer: string;
  /** The SHA-256 hash of the message that was signed. */
  messageHash: Uint8Array<ArrayBuffer>;
}

/**
 * Data extracted from a secp256r1 signature verification instruction.
 */
export interface Secp256r1VerifyData {
  /** The index of this instruction within the transaction. */
  instructionIndex: number;
  /** The raw instruction data containing the verification payload. */
  data?: ReadonlyUint8Array;
}

/**
 * Result of processing a multi-wallet instruction.
 */
export interface ProcessingResult {
  /** The settings account address (base58-encoded) for the multi-wallet. */
  settingsAddress: string;
  /** List of signers extracted from the secp256r1 verification instructions. */
  signers: SignerInfo[];
  /** The instructions that need to be verified for authorization. */
  instructionsToVerify: Instruction[];
}

/**
 * Parsed clientDataJSON from a WebAuthn assertion response.
 */
export interface ClientDataJSON {
  /** The base64url-encoded challenge that was signed. */
  challenge: string;
  /** The origin of the relying party that requested the signature. */
  origin: string;
  /** The type of WebAuthn operation (should be "webauthn.get"). */
  type: string;
}

/**
 * Cache entry for well-known client public keys.
 */
export interface WellKnownCacheEntry {
  /** The client's public key in JWK format. */
  publicKey: JsonWebKey;
  /** Unix timestamp (ms) when this entry was cached. */
  timestamp: number;
}
