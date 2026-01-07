import type { TransactionPayloadWithBase64MessageBytes } from "@revibase/core";
import {
  bufferToBase64URLString,
  type CompleteTransactionRequest,
  type StartTransactionRequest,
} from "@revibase/core";
import { address, getAddressEncoder, getU64Encoder } from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";
import type { RevibaseProvider } from "src/provider/main";

export async function transferTokens(
  provider: RevibaseProvider,
  args: {
    amount: number | bigint;
    destination: string;
    signer?: string;
    mint?: string;
    tokenProgram?: string;
  }
) {
  provider.openBlankPopUp();

  const {
    mint,
    tokenProgram = TOKEN_PROGRAM_ADDRESS,
    amount,
    destination,
    signer,
  } = args;
  const redirectOrigin = window.origin;

  const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
    transactionActionType: "transfer_intent",
    transactionAddress: mint ? tokenProgram : SYSTEM_PROGRAM_ADDRESS,
    transactionMessageBytes: bufferToBase64URLString(
      new Uint8Array([
        ...getU64Encoder().encode(amount),
        ...getAddressEncoder().encode(address(destination)),
        ...getAddressEncoder().encode(address(mint ?? SYSTEM_PROGRAM_ADDRESS)),
      ])
    ),
  };

  const payload: StartTransactionRequest = {
    phase: "start",
    data: {
      type: "transaction" as const,
      payload: transactionPayload,
    },
    redirectOrigin,
    signer,
  };

  const { signature } = await provider.onClientAuthorizationCallback(payload);
  const response = (await provider.sendPayloadToProvider({
    payload,
    signature,
  })) as CompleteTransactionRequest;

  return await provider.onClientAuthorizationCallback({
    ...response,
    data: {
      ...response.data,
      payload: { ...response.data.payload, transactionPayload },
    },
  });
}
