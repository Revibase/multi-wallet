import type { Secp256r1Key } from "@revibase/core";
import type {
  Address,
  Instruction,
  ReadonlyUint8Array,
  TransactionMessageBytes,
} from "gill";

/**
 * Configuration for the Transaction Manager.
 */
export interface TransactionManagerConfig {
  /** The public key (base58-encoded) of the transaction manager. */
  publicKey: string;
  /** The URL endpoint where the transaction manager service is hosted. */
  url: string;
}

/**
 * Information about a signer extracted from a secp256r1 verification instruction.
 *
 * Produced when parsing a transaction that contains secp256r1 (e.g. passkey)
 * verification instructions. Used as input for signature verification.
 */
export type SignerInfo = {
  /** The signer's public key. */
  signer: Secp256r1Key | Address;
  /** The SHA-256 hash of the message that was signed (used to verify the signature). */
  messageHash?: Uint8Array<ArrayBuffer>;
};

/**
 * Data extracted from a secp256r1 signature verification instruction.
 *
 * Captures the instruction index and raw payload; used to locate and decode
 * verification args (public key, signature, message hash) for verification.
 */
export interface Secp256r1VerifyData {
  /** The index of this instruction within the transaction. */
  instructionIndex: number;
  /** The raw instruction data containing the verification payload. Omitted if the instruction had no data. */
  data?: ReadonlyUint8Array;
}

/**
 * Result of processing a multi-wallet transaction for verification.
 *
 * After parsing the transaction, this aggregates the settings account,
 * signers from secp256r1 verification instructions, and the set of
 * instructions that must be covered by those signers for authorization.
 */
export interface ProcessingResult {
  /** The settings account address (base58-encoded) for the multi-wallet. */
  settingsAddress: string;
  /** Signers extracted from secp256r1 verification instructions in the transaction. */
  signers: SignerInfo[];
  /** Instructions that must be authorized by the verified signers. */
  instructionsToVerify: Instruction[];
}

/**
 * Parsed clientDataJSON from a WebAuthn assertion response.
 *
 * The browser/platform provides this as part of the credential response;
 * the challenge is used to bind the assertion to the current verification request.
 */
export interface ClientDataJSON {
  /** The base64url-encoded challenge that was signed by the authenticator. */
  challenge: Base64URLString;
}

/**
 * Cached entry for a well-known client (e.g. from /.well-known or config).
 *
 * Stores the client's public key and optionally the device keys it has
 * explicitly trusted, plus cache metadata for freshness.
 */
export interface WellKnownClientCacheEntry {
  /** The client's public key, encoded as a Base64 string in JWK format. */
  clientJwk: string;

  /**
   * Optional list of device public keys trusted by this client,
   * each encoded as a Base64 string in JWK format.
   */
  trustedDeviceJwks?: string[];

  /** Unix timestamp (milliseconds) when this entry was cached. */
  cachedAt: number;
}

/**
 * A signer that has been successfully verified during transaction verification.
 *
 * Includes the signer's public key, the wallet they are authorized for, and
 * the client/device context (origin, JWK, trusted devices) that produced the
 * signature. Used to record who signed and from which app/device.
 */
export type VerifiedSigner =
  | {
      /** The public key of the verified signer. */
      signer: Secp256r1Key;
      /** The wallet address that this signer is signing for. */
      walletAddress: Address;
      /**
       * Client identity and cache entry: origin plus JWK and trusted devices.
       * Identifies which application requested the signature for this transaction.
       */
      client: {
        origin: string;
      } & WellKnownClientCacheEntry;
      /**
       * The device public key or identifier that produced the signature.
       * Uniquely identifies the device that requested the signature for this transaction.
       */
      device: string;
      /**
       * The authentication provider, if known.
       * When set, indicates the transaction was already verified once by that provider.
       */
      authProvider: string | undefined;
    }
  | {
      /** The public key of the signer. */
      signer: Address;
      /** The wallet address that this signer is signing for. */
      walletAddress: Address;
    };

/**
 * Result of verifying a transaction.
 *
 * Contains the serialized transaction message and an array of verification
 * batches. Each batch pairs the extracted instructions with the
 * signers that successfully passed verification for those instructions.
 */
export interface VerificationResults {
  /** The raw transaction message bytes that were verified. */
  transactionMessage: TransactionMessageBytes;
  /**
   * One entry per verification batch. Each entry lists the instructions
   * extracted in that batch and the signers that passed verification.
   */
  verificationResults: {
    instructions: Instruction[];
    verifiedSigners: VerifiedSigner[];
  }[];
}
