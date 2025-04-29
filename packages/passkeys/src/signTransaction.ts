import {
  AuthenticationResponse,
  BasePayload,
  DEFAULT_AUTH_URL,
  TransactionPayload,
} from "./utils";
import {
  convertTransactionPayload,
  openAuthUrl,
  parseAuthenticationResponse,
} from "./utils/internal";

export async function signTransaction({
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  additionalInfo,
  authUrl = DEFAULT_AUTH_URL,
  hints,
  publicKey,
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
    publicKey,
    popUp,
    debug,
    hints,
  })) as AuthenticationResponse;
  return await parseAuthenticationResponse(authResponse);
}
