import type {
  CompleteTransactionRequest,
  StartTransactionRequest,
} from "@revibase/core";
import {
  bufferToBase64URLString,
  type BasePayload,
  type TransactionPayload,
} from "@revibase/core";
import { createPopUp } from "./helper";
import { openAuthUrl } from "./internal";
import type { ClientAuthorizationCallback } from "./types";

export async function signAndSendTransactionWithPasskey({
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  signer,
  popUp,
  authOrigin,
  onClientAuthorizationCallback,
}: TransactionPayload &
  BasePayload & {
    onClientAuthorizationCallback: ClientAuthorizationCallback;
  }) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const redirectOrigin = window.origin;
  const authUrl = `${authOrigin}?redirectOrigin=${redirectOrigin}`;

  const payload: StartTransactionRequest = {
    phase: "start",
    data: {
      type: "transaction" as const,
      payload: {
        transactionActionType,
        transactionAddress,
        transactionMessageBytes: bufferToBase64URLString(
          transactionMessageBytes
        ),
      },
    },
    redirectOrigin,
    signer,
  };

  const [popupWindow, { signature }] = await Promise.all([
    Promise.resolve(popUp ?? createPopUp(authUrl)),
    onClientAuthorizationCallback(payload),
  ]);

  const response = (await openAuthUrl({
    authUrl,
    payload,
    signature,
    popUp: popupWindow,
  })) as CompleteTransactionRequest;

  if (response.data.type !== "transaction") {
    throw new Error("Expected Transaction Response");
  }

  return await onClientAuthorizationCallback(response);
}
