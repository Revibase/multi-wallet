import {
  Secp256r1Key,
  type BasePayload,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
} from "../types";
import {
  getAuthEndpoint,
  getGlobalAdditonalInfo,
  getWhitelistedAddressTreeIndexFromAddress,
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
    signer: new Secp256r1Key(authResponse.signer),
    userAddressTreeIndex: authResponse.userAddressTree
      ? await getWhitelistedAddressTreeIndexFromAddress(
          authResponse.userAddressTree
        )
      : undefined,
  } as TransactionAuthenticationResponse;
}
