import {
  KeyType,
  SignedSecp256r1Key,
  type CompleteTransactionRequest,
  type TransactionPayloadWithBase64MessageBytes,
  type UserInfo,
} from "@revibase/core";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  address,
  getAddressEncoder,
  getBase64Decoder,
  getU64Encoder,
  type TransactionSigner,
} from "@solana/kit";
import type { RevibaseProvider } from "../provider/main";
import { withRetry } from "../utils/retry";
import { sendTransaction } from "../utils/transactions/sendTransaction";
import { getRandomPayer } from "../utils/transactions/utils";
import type { TransactionAuthorizationFlowOptions } from "../utils/types";

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
    additionalVoters?: (TransactionSigner | SignedSecp256r1Key)[];
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
    additionalVoters,
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
    return {
      request: { ...payload, rid, validTill },
      signature,
      additionalVoters: additionalVoters?.map((x) =>
        x instanceof SignedSecp256r1Key
          ? { keyType: KeyType.Secp256r1, publicKey: x.toString() }
          : { keyType: KeyType.Ed25519, publicKey: x.address.toString() },
      ),
      payer: (payer ?? (await getRandomPayer())).address.toString(),
    };
  };

  const onSuccessCallback = async (
    result: CompleteTransactionRequest,
  ): Promise<{ txSig: string; user: UserInfo }> => {
    const { signature } = await provider.onClientAuthorizationCallback(result);
    const txSig = await sendTransaction(provider, {
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
      additionalVoters,
      payer: payer ?? (await getRandomPayer()),
    });

    return { txSig, user: result.data.payload.user };
  };

  return provider.sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal: options?.signal,
  });
}
