import { getSolanaRpc } from "@revibase/core";
import type { Signature } from "gill";
import { withRetry } from "../retry";

export async function pollTransactionConfirmation(
  txSig: string,
  maxRetries = 30,
  delayMs = 2000,
): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const status = await withRetry(() =>
      getSolanaRpc()
        .getSignatureStatuses([txSig as Signature])
        .send(),
    );

    const confirmation = status.value[0];

    if (
      confirmation?.confirmationStatus === "confirmed" ||
      confirmation?.confirmationStatus === "finalized"
    ) {
      return txSig;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("Transaction confirmation timeout");
}
