import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";
import { startRequest } from "./startRequest";
import { verifyMessage } from "./verifyMessage";
import { verifyTransaction } from "./verifyTransaction";

/** Validates start request, calls Revibase start + getResult, returns user or tx. Pass req.signal for cancel on disconnect. */
export async function processClientAuthCallback({
  request,
  publicKey,
  allowedClientOrigins,
  privateKey,
  providerOrigin,
  rpId,
}: {
  request:
    | Omit<StartMessageRequest, "validTill">
    | Omit<StartTransactionRequest, "validTill">
    | CompleteMessageRequest
    | CompleteTransactionRequest;
  allowedClientOrigins: string[];
  publicKey: string;
  privateKey: string;
  providerOrigin?: string;
  rpId?: string;
}): Promise<
  | { signature: string; validTill: number }
  | { user: UserInfo }
  | CompleteTransactionRequest
> {
  if (request.phase === "start") {
    return await startRequest(request, allowedClientOrigins, privateKey);
  } else if (request.phase === "complete") {
    if (request.data.type === "message") {
      return await verifyMessage(
        request as CompleteMessageRequest,
        publicKey,
        allowedClientOrigins,
        providerOrigin,
        rpId,
      );
    } else if (request.data.type === "transaction") {
      return await verifyTransaction(
        request as CompleteTransactionRequest,
        publicKey,
        allowedClientOrigins,
        privateKey,
        providerOrigin,
        rpId,
      );
    } else {
      throw new Error("Invalid request type");
    }
  } else {
    throw new Error("Invalid request phase");
  }
}
