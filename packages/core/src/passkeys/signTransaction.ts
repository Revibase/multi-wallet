import {
  type BasePayload,
  type ClientAuthorizationCompleteRequest,
  type ClientAuthorizationStartRequest,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
} from "../types";
import { getAuthEndpoint, getOnClientAuthorizationCallback } from "../utils";
import { bufferToBase64URLString, createPopUp } from "../utils/passkeys/helper";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signTransactionWithPasskey({
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  signer,
  popUp,
}: TransactionPayload &
  BasePayload): Promise<TransactionAuthenticationResponse> {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const redirectOrigin = window.origin;
  const authUrl = `${getAuthEndpoint()}?redirectOrigin=${redirectOrigin}`;

  const authorization = getOnClientAuthorizationCallback();
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
    authorization(payload),
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

  const finalSignature = await authorization(response);

  return {
    ...response.data.payload,
    clientSignature: {
      ...response.data.payload.clientSignature,
      signature: finalSignature,
    },
  };
}
