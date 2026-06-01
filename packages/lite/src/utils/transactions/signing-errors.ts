import {
  isSolanaError,
  SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING,
} from "@solana/errors";
import type { AbortScope } from "../abort";
import { RevibaseError } from "../errors";

/** User-facing error when Kit reports missing transaction signatures. */
export class RevibaseMissingSignersError extends RevibaseError {
  readonly missingAddresses: readonly string[];

  constructor(missingAddresses: readonly string[]) {
    const message = [
      `Missing signature(s) for: ${missingAddresses.join(", ")}.`,
      "Pass required keypairs in executeTransaction({ additionalSigners: [...] }).",
    ].join(" ");
    super(message, "MISSING_SIGNERS");
    this.name = "RevibaseMissingSignersError";
    this.missingAddresses = missingAddresses;
    Object.setPrototypeOf(this, RevibaseMissingSignersError.prototype);
  }
}

export function rethrowSigningError(
  error: unknown,
  abortScope?: AbortScope,
): never {
  abortScope?.abort(error instanceof Error ? error : undefined);

  if (isSolanaError(error, SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING)) {
    const missingAddresses = error.context.addresses.map((a) => String(a));
    if (missingAddresses.length > 0) {
      throw new RevibaseMissingSignersError(missingAddresses);
    }
  }

  throw error;
}
