import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import { createClientAuthorizationStartRequestChallenge } from "@revibase/core";
import { getBase58Decoder, type TransactionSigner } from "gill";
import { createSignInMessageText } from "src/utils/internal";
import { processBundledTransaction } from "./processBundledTransaction";
import { processMessage } from "./processMessage";
import { processSyncTransaction } from "./processSyncTransaction";
import { processTokenTransfer } from "./processTokenTransfer";

export async function processClientAuthCallback(
  request:
    | StartTransactionRequest
    | StartMessageRequest
    | CompleteTransactionRequest
    | CompleteMessageRequest,
  privateKey: CryptoKey,
  feePayer?: TransactionSigner,
  expectedOrigin?: string,
  expectedRPID?: string
) {
  // Start Request
  if (request.phase === "start") {
    const { data } = request;

    if (data.type === "message") {
      const message =
        data.payload ??
        createSignInMessageText({
          domain: "your_website_name",
          nonce: crypto.randomUUID(),
        });
      const challenge = createClientAuthorizationStartRequestChallenge({
        ...request,
        data: { ...data, payload: message },
      });
      const signature = getBase58Decoder().decode(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "Ed25519" },
            privateKey,
            new Uint8Array(challenge)
          )
        )
      );
      return { signature, message };
    } else {
      const challenge = createClientAuthorizationStartRequestChallenge(request);
      const signature = getBase58Decoder().decode(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "Ed25519" },
            privateKey,
            new Uint8Array(challenge)
          )
        )
      );
      return { signature };
    }
  }

  // Complete Request
  if (request.data.type === "message") {
    const user = await processMessage(
      { phase: "complete", data: request.data },
      expectedOrigin,
      expectedRPID
    );
    return { user };
  }

  const { transactionActionType } = request.data.payload.transactionPayload;

  if (transactionActionType === "transfer_intent") {
    const signature = await processTokenTransfer(
      { phase: "complete", data: request.data },
      privateKey,
      feePayer
    );
    return { signature };
  } else if (transactionActionType === "sync") {
    const signature = await processSyncTransaction(
      { phase: "complete", data: request.data },
      privateKey,
      feePayer
    );
    return { signature };
  } else if (
    transactionActionType === "execute" ||
    transactionActionType === "create_with_preauthorized_execution"
  ) {
    const signature = await processBundledTransaction(
      { phase: "complete", data: request.data },
      privateKey,
      feePayer
    );
    return { signature };
  } else {
    throw new Error("Transaction action type not allowed.");
  }
}
