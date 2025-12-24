import { address, getAddressEncoder, getU64Encoder } from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import { signAndSendTransactionWithPasskey } from "src/utils/signAndSendTransactionWithPasskey";
import type { ClientAuthorizationCallback } from "src/utils/types";

export async function transferTokens(
  onClientAuthorizationCallback: ClientAuthorizationCallback,
  amount: number | bigint,
  destination: string,
  signer?: string,
  mint?: string,
  tokenProgram?: string,
  authOrigin?: string,
  popUp?: Window | null | undefined
) {
  return signAndSendTransactionWithPasskey({
    transactionActionType: "transfer_intent",
    transactionAddress: mint
      ? (tokenProgram ?? TOKEN_PROGRAM_ADDRESS)
      : SYSTEM_PROGRAM_ADDRESS,
    transactionMessageBytes: new Uint8Array([
      ...getU64Encoder().encode(amount),
      ...getAddressEncoder().encode(address(destination)),
      ...getAddressEncoder().encode(address(mint ?? SYSTEM_PROGRAM_ADDRESS)),
    ]),
    signer,
    popUp,
    onClientAuthorizationCallback,
    authOrigin: authOrigin ?? REVIBASE_AUTH_URL,
  });
}
