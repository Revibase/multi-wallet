import {
  Secp256r1Key,
  type BasePayload,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
} from "../types";
import { getAuthEndpoint, getGlobalAdditonalInfo } from "../utils";
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
  const authResponse = (await openAuthUrl({
    authUrl: `${getAuthEndpoint()}/?redirectUrl=${encodeURIComponent(window.origin)}`,
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
    additionalInfo: getGlobalAdditonalInfo(),
    signer,
    popUp,
  })) as any;
  return {
    ...authResponse,
    signer: {
      member: new Secp256r1Key(authResponse.signer),
      userAddressTreeIndex: authResponse.userAddressTreeIndex,
    },
  } as TransactionAuthenticationResponse;
}
