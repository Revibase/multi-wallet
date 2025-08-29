import {
  BasePayload,
  TransactionAuthenticationResponse,
  TransactionPayload,
} from "../types";
import {
  convertTransactionPayload,
  openAuthUrl,
  parseAuthenticationResponse,
} from "../utils/passkeys/internal";

export async function signTransaction({
  authUrl = "https://auth.revibase.com",
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  additionalInfo,
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
  })) as TransactionAuthenticationResponse;
  return await parseAuthenticationResponse(authResponse);
}
