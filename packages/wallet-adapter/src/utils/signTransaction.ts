import {
  bufferToBase64URLString,
  type BasePayload,
  type ClientAuthorizationCompleteRequest,
  type ClientAuthorizationStartRequest,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
} from "@revibase/core";
import { createPopUp } from "./helper";
import { openAuthUrl } from "./internal";

export async function signTransactionWithPasskey({
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  signer,
  popUp,
  authOrigin,
  onClientAuthorizationCallback,
}: TransactionPayload &
  BasePayload): Promise<TransactionAuthenticationResponse> {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const redirectOrigin = window.origin;
  const authUrl = `${authOrigin}?redirectOrigin=${redirectOrigin}`;

  const payload: ClientAuthorizationStartRequest = {
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

  const [popupWindow, initialSignature] = await Promise.all([
    Promise.resolve(popUp ?? createPopUp(authUrl)),
    onClientAuthorizationCallback(payload),
  ]);

  const response = (await openAuthUrl({
    authUrl,
    payload,
    signature: initialSignature,
    popUp: popupWindow,
  })) as ClientAuthorizationCompleteRequest;

  if (response.data.type !== "transaction") {
    throw new Error("Expected Transaction Response");
  }

  const finalSignature = await onClientAuthorizationCallback(response);

  return {
    ...response.data.payload,
    clientSignature: {
      ...response.data.payload.clientSignature,
      signature: finalSignature,
    },
  };
}
