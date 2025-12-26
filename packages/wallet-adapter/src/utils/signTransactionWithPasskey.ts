import type {
  CompleteTransactionRequest,
  StartTransactionRequest,
  TransactionPayload,
} from "@revibase/core";
import {
  bufferToBase64URLString,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import type { RevibaseProvider } from "src/provider";

export async function signTransactionWithPasskey({
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  signer,
  provider,
}: {
  transactionActionType: TransactionPayload["transactionActionType"];
  transactionAddress: TransactionPayload["transactionAddress"];
  transactionMessageBytes: TransactionPayload["transactionMessageBytes"];
  signer?: string;
  provider: RevibaseProvider;
}): Promise<TransactionAuthenticationResponse> {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }
  const transactionPayload = {
    transactionActionType,
    transactionAddress,
    transactionMessageBytes: bufferToBase64URLString(transactionMessageBytes),
  };
  const redirectOrigin = window.origin;

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

  const { signature: finalSignature } =
    await provider.onClientAuthorizationCallback({
      ...response,
      data: {
        ...response.data,
        payload: { ...response.data.payload, transactionPayload },
      },
    });

  return {
    ...response.data.payload,
    clientSignature: {
      ...response.data.payload.clientSignature,
      signature: finalSignature,
    },
  };
}
