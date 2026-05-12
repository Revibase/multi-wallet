import {
  initialize,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/core";
import { startRequest } from "./startRequest";
import { verifyMessage } from "./verifyMessage";
import { verifyTransaction } from "./verifyTransaction";

let initialized = false;
function ensureInitialize(rpcEndpoint?: string) {
  if (initialized) return;
  if (rpcEndpoint) {
    initialize({ rpcEndpoint });
    initialized = true;
  }
}
/** Validates start request, calls Revibase start + getResult, returns user or tx. Pass req.signal for cancel on disconnect. */
export async function processClientAuthCallback({
  request,
  publicKey,
  allowedClientOrigins,
  privateKey,
  requireTwoFactorAuthentication,
}: {
  request:
    | Omit<StartMessageRequest, "validTill">
    | Omit<StartTransactionRequest, "validTill">
    | CompleteMessageRequest
    | CompleteTransactionRequest;
  allowedClientOrigins: string[];
  publicKey: string;
  privateKey: string;
  requireTwoFactorAuthentication?: {
    rpcEndpoint: string;
  };
}) {
  ensureInitialize(requireTwoFactorAuthentication?.rpcEndpoint);

  if (request.phase === "start") {
    if (
      request.data.type === "message" &&
      !!requireTwoFactorAuthentication !==
        request.data.requireTwoFactorAuthentication
    ) {
      throw new Error("Require 2fa check mismatch");
    }
    return await startRequest(request, allowedClientOrigins, privateKey);
  } else if (request.phase === "complete") {
    if (request.data.type === "message") {
      return await verifyMessage(
        request as CompleteMessageRequest,
        publicKey,
        allowedClientOrigins,
        !!requireTwoFactorAuthentication,
      );
    } else if (request.data.type === "transaction") {
      return await verifyTransaction(
        request as CompleteTransactionRequest,
        publicKey,
        allowedClientOrigins,
        privateKey,
      );
    } else {
      throw new Error("Invalid request type");
    }
  } else {
    throw new Error("Invalid request phase");
  }
}
