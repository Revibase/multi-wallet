import {
  Secp256r1Key,
  type BasePayload,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
} from "../types";
import { getAuthUrl, getGlobalAdditonalInfo } from "../utils";
import {
  bufferToBase64URLString,
  openAuthUrl,
} from "../utils/passkeys/internal";

export async function signTransactionWithPasskey({
  authUrl = getAuthUrl(),
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  additionalInfo = getGlobalAdditonalInfo(),
  signer,
  popUp,
  debug,
}: TransactionPayload & BasePayload) {
  const authResponse = (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    data: {
      type: "transaction",
      payload: JSON.stringify({
        transactionActionType,
        transactionAddress,
        transactionMessageBytes: bufferToBase64URLString(
          transactionMessageBytes
        ),
      }),
    },
    additionalInfo,
    signer,
    popUp,
    debug,
  })) as any;
  return {
    ...authResponse,
    signer: new Secp256r1Key(authResponse.signer),
  } as TransactionAuthenticationResponse;
}
