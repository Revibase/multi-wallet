import {
  convertMemberKeyToString,
  fetchSettings,
  getSettingsFromIndex,
  getSolanaRpc,
  KeyType,
  prepareTransactionMessage,
  SignedSecp256r1Key,
  UserRole,
  type CompleteTransactionRequest,
  type TransactionPayloadWithBase64MessageBytes,
  type UserInfo,
} from "@revibase/core";
import {
  address,
  getBase64Decoder,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import type { RevibaseProvider } from "../provider/main";
import { withRetry } from "../utils/retry";
import { sendTransaction } from "../utils/transactions";
import { getRandomPayer } from "../utils/transactions/utils";
import type { TransactionAuthorizationFlowOptions } from "../utils/types";

/** Custom transaction. Action from wallet settings (TransactionManager). Provider needs rpcEndpoint. Options: signal?, channelId?. */
export async function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: UserInfo;
    payer?: TransactionSigner;
    settingsIndexWithAddress?: {
      index: number | bigint;
    };
    additionalSigners?: TransactionSigner[];
    additionalVoters?: (TransactionSigner | SignedSecp256r1Key)[];
  },
  options?: TransactionAuthorizationFlowOptions,
): Promise<{ txSig?: string; user: UserInfo }> {
  const {
    instructions,
    signer,
    settingsIndexWithAddress,
    additionalSigners,
    additionalVoters,
    payer,
  } = args;

  const onConnectedCallback = async (rid: string, clientOrigin: string) => {
    const transactionMessageBytes = prepareTransactionMessage({
      payer: address(signer.walletAddress),
      instructions,
    });
    const settingsArgs =
      settingsIndexWithAddress ?? signer.settingsIndexWithAddress;
    const settings = await getSettingsFromIndex(settingsArgs.index);
    const settingsData = (
      await withRetry(() => fetchSettings(getSolanaRpc(), settings))
    ).data;
    const transactionManagerAddress = settingsData.members.find(
      (x) => x.role === UserRole.TransactionManager,
    )?.pubkey;
    const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
      transactionMessageBytes: getBase64Decoder().decode(
        transactionMessageBytes,
      ),
      transactionAddress: settings,
      transactionActionType: transactionManagerAddress
        ? "execute"
        : "create_with_preauthorized_execution",
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
      signer: signer.publicKey,
    };
    const { signature, validTill } = await withRetry(() =>
      provider.onClientAuthorizationCallback(payload),
    );
    return {
      request: { ...payload, rid, validTill },
      signature,
      transactionManagerAddress: transactionManagerAddress
        ? convertMemberKeyToString(transactionManagerAddress)
        : undefined,
      additionalSigners: additionalSigners?.map((x) => x.address.toString()),
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
      additionalSigners,
      additionalVoters,
      payer: payer ?? (await getRandomPayer()),
    });

    return { user: result.data.payload.user, txSig };
  };

  return provider.sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal: options?.signal,
  });
}
