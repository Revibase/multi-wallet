import {
  Secp256r1Key,
  type BasePayload,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
} from "../types";
import { getAuthUrl, getGlobalAdditonalInfo } from "../utils";
import {
  convertTransactionPayload,
  openAuthUrl,
} from "../utils/passkeys/internal";

export async function signTransactionWithPasskey({
  authUrl = getAuthUrl(),
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  additionalInfo = getGlobalAdditonalInfo(),
  hints,
  signer,
  popUp,
  debug,
}: TransactionPayload & BasePayload) {
  const authResponse = (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    data: {
      type: "transaction",
      payload: convertTransactionPayload({
        transactionActionType,
        transactionAddress,
        transactionMessageBytes,
      }),
    },
    additionalInfo,
    signer,
    popUp,
    debug,
    hints,
  })) as any;
  return {
    ...authResponse,
    signer: new Secp256r1Key(authResponse.signer),
  } as TransactionAuthenticationResponse;
}
