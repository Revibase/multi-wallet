import {
  AuthenticationResponse,
  BasePayload,
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
  credentialId,
  transports,
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
    credentialId,
    transports,
    popUp,
    debug,
    hints,
  })) as AuthenticationResponse;
  return await parseAuthenticationResponse(authResponse);
}
