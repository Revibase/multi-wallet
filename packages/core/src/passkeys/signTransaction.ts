import { getBase64Decoder } from "gill";
import {
  Secp256r1Key,
  type BasePayload,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
} from "../types";
import { getAuthEndpoint, getClientSettings } from "../utils";
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
  const { clientId, signClientMessage } = getClientSettings();
  const data = {
    type: "transaction" as const,
    payload: JSON.stringify({
      transactionActionType,
      transactionAddress,
      transactionMessageBytes: bufferToBase64URLString(transactionMessageBytes),
    }),
  };
  const payload = getBase64Decoder().decode(
    new Uint8Array([
      ...new TextEncoder().encode(JSON.stringify(data)),
      ...(signer ? signer.toBuffer() : []),
    ])
  );
  const { signature, expiry } = await signClientMessage("start", payload);
  const authUrl =
    `${getAuthEndpoint()}/?` +
    `redirectUrl=${encodeURIComponent(window.origin)}` +
    `&clientId=${encodeURIComponent(clientId)}` +
    `&signature=${encodeURIComponent(signature)}` +
    `&expiry=${encodeURIComponent(expiry)}`;
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
