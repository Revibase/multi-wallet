import {
  fetchUserAccountByFilters,
  getDomainConfigAddress,
  type CompleteTransactionRequest,
  type TransactionPayloadWithBase64MessageBytes,
  type UserInfo,
} from "@revibase/core";
import {
  address,
  getAddressEncoder,
  getBase64Decoder,
  getU64Encoder,
  type AddressesByLookupTableAddress,
  type TransactionSigner,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";
import type { RevibaseProvider } from "../provider/main";
import { withRetry } from "../utils/retry";
import { sendTransaction } from "../utils/transactions/sendTransaction";
import type { TransactionAuthorizationFlowOptions } from "../utils/types";
import { convertToUserInfo } from "../utils/user";

/** Transfers SOL or SPL (set mint for SPL). amount &gt; 0, destination required */
export async function transferTokens(
  provider: RevibaseProvider,
  args: {
    amount: number | bigint;
    destination: string;
    signer?: UserInfo;
    mint?: string;
    tokenProgram?: string;
    payer?: TransactionSigner;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
  options?: TransactionAuthorizationFlowOptions,
): Promise<{ txSig?: string; user: UserInfo }> {
  if (args.amount <= 0) {
    throw new Error("Transfer amount must be greater than 0");
  }

  if (!args.destination || typeof args.destination !== "string") {
    throw new Error("Destination address is required");
  }

  const {
    mint,
    tokenProgram = TOKEN_PROGRAM_ADDRESS,
    amount,
    destination,
    signer,
    payer,
    addressesByLookupTableAddress,
  } = args;

  const onConnectedCallback = async (rid: string, clientOrigin: string) => {
    const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
      transactionActionType: "transfer_intent",
      transactionAddress: mint ? tokenProgram : SYSTEM_PROGRAM_ADDRESS,
      transactionMessageBytes: getBase64Decoder().decode(
        new Uint8Array([
          ...getU64Encoder().encode(amount),
          ...getAddressEncoder().encode(address(destination)),
          ...getAddressEncoder().encode(
            address(mint ?? SYSTEM_PROGRAM_ADDRESS),
          ),
        ]),
      ),
    };

    const payload = {
      phase: "start" as const,
      rid,
      providerOrigin: provider.providerOrigin,
      rpId: provider.rpId,
      data: {
        type: "transaction" as const,
        payload: transactionPayload,
      },
      clientOrigin,
      signer: signer?.publicKey,
    };
    const { signature, validTill } = await withRetry(() =>
      provider.onClientAuthorizationCallback(payload),
    );
    return { request: { ...payload, rid, validTill }, signature };
  };

  const onSuccessCallback = async (
    result: CompleteTransactionRequest,
  ): Promise<{ txSig: string; user: UserInfo }> => {
    const { signature } = await provider.onClientAuthorizationCallback(result);
    const userAccount = await withRetry(async () =>
      fetchUserAccountByFilters(
        await getDomainConfigAddress({
          rpId: result.data.payload.startRequest.rpId,
        }),
        { credentialId: result.data.payload.authResponse.id },
      ),
    );
    if (!userAccount) {
      throw new Error("User not found.");
    }
    const user = await convertToUserInfo(userAccount);
    const txSig = await sendTransaction(provider, {
      user,
      request: {
        ...result,
        data: {
          ...result.data,
          payload: {
            ...result.data.payload,
            client: { ...result.data.payload.client, jws: signature },
          },
        },
      },
      options,
      addressesByLookupTableAddress,
      payer,
    });

    return { txSig, user };
  };

  return provider.sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal: options?.signal,
  });
}
