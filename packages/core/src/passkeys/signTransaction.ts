import {
  Secp256r1Key,
  type BasePayload,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
} from "../types";
import {
  getAuthEndpoint,
  getClientMessageHash,
  getClientSettings,
} from "../utils";
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
  const { clientId, signClientMessage } = getClientSettings();
  const redirectUrl = window.origin;
  const data = {
    type: "transaction" as const,
    payload: JSON.stringify({
      transactionActionType,
      transactionAddress,
      transactionMessageBytes: bufferToBase64URLString(transactionMessageBytes),
    }),
  };
  const clientMessageHash = getClientMessageHash(
    data,
    clientId,
    redirectUrl,
    signer?.toString()
  );
  const { signature, expiry } = await signClientMessage(
    "start",
    clientMessageHash
  );
  const authUrl =
    `${getAuthEndpoint()}/?` +
    `redirectUrl=${encodeURIComponent(redirectUrl)}` +
    `&clientId=${encodeURIComponent(clientId)}` +
    `&signature=${encodeURIComponent(signature)}` +
    `&expiry=${encodeURIComponent(expiry)}` +
    `&messageHash=${encodeURIComponent(clientMessageHash)}`;

  const authResponse = (await openAuthUrl({
    authUrl,
    data,
    signer,
    popUp,
  })) as any;
  return {
    ...authResponse,
    signer: new Secp256r1Key(authResponse.signer),
  } as TransactionAuthenticationResponse;
}
