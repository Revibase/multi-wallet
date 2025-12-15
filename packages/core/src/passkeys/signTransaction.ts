import { type BasePayload, type TransactionPayload } from "../types";
import { getAuthEndpoint, getOnClientAuthorizationCallback } from "../utils";
import {
  bufferToBase64URLString,
  openAuthUrl,
} from "../utils/passkeys/internal";

export async function signTransactionWithPasskey({
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  signer,
  popUp,
}: TransactionPayload & BasePayload) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }
  const redirectOrigin = window.origin;
  const data = {
    type: "transaction" as const,
    payload: {
      transactionActionType,
      transactionAddress,
      transactionMessageBytes: bufferToBase64URLString(transactionMessageBytes),
    },
  };
  const sessionToken = await getOnClientAuthorizationCallback()({
    phase: "start",
    data,
    redirectOrigin,
    signer,
  });
  await openAuthUrl({
    authUrl: `${getAuthEndpoint()}&sessionToken=${sessionToken}`,
    popUp,
  });
  const result = await getOnClientAuthorizationCallback()({
    phase: "complete",
    data: {
      type: "transaction",
      sessionToken,
    },
  });
  return result;
}
