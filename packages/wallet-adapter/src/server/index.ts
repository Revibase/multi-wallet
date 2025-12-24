import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import {
  createClientAuthorizationCompleteRequestChallenge,
  createClientAuthorizationStartRequestChallenge,
} from "@revibase/core";
import { getBase58Decoder } from "gill";
import { createSignInMessageText } from "src/utils/internal";
import { processMessage } from "./processMessage";

export async function processClientAuthCallback(
  request:
    | StartTransactionRequest
    | StartMessageRequest
    | CompleteTransactionRequest
    | CompleteMessageRequest,
  privateKey: CryptoKey,
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
  const challenge = createClientAuthorizationCompleteRequestChallenge(request);
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
