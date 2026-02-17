import type {
  AdditionalSignersParam,
  StartTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
  UserInfo,
} from "@revibase/core";
import {
  fetchSettingsAccountData,
  getSettingsFromIndex,
  prepareTransactionMessage,
  UserRole,
} from "@revibase/core";
import {
  address,
  getBase64Decoder,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "gill";
import type { RevibaseProvider } from "src/provider/main";
import { DEFAULT_TIMEOUT } from "src/provider/utils";

/**
 * Executes a transaction using the Revibase provider.
 * Automatically determines whether to use bundling based on transaction size.
 *
 * @param provider - Revibase provider instance
 * @param args - Transaction arguments including instructions, signer, and optional lookup tables
 * @returns Transaction signature
 * @throws {Error} If transaction execution fails
 */
export async function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: UserInfo;
    additionalSigners?: AdditionalSignersParam;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
  rid?: string,
): Promise<{ txSig: string; user: UserInfo }> {
  const { instructions, signer, addressesByLookupTableAddress } = args;
  const transactionMessageBytes = prepareTransactionMessage({
    payer: address(signer.walletAddress),
    instructions,
    addressesByLookupTableAddress,
  });
  const settings = await getSettingsFromIndex(
    signer.settingsIndexWithAddress.index,
  );
  const walletInfo = await fetchSettingsAccountData(
    settings,
    signer.settingsIndexWithAddress.settingsAddressTreeIndex,
  );

  const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
    transactionMessageBytes: getBase64Decoder().decode(transactionMessageBytes),
    transactionAddress: settings,
    transactionActionType: walletInfo.members.some(
      (x) => x.role === UserRole.TransactionManager,
    )
      ? "execute"
      : "create_with_preauthorized_execution",
  };

  const redirectOrigin = window.origin;
  rid =
    rid ??
    getBase64Decoder().decode(crypto.getRandomValues(new Uint8Array(16)));

  const payload: StartTransactionRequest = {
    phase: "start",
    rid,
    validTill: Date.now() + DEFAULT_TIMEOUT,
    data: {
      type: "transaction" as const,
      payload: transactionPayload,
      sendTx: true,
      additionalSigners: args.additionalSigners,
    },
    redirectOrigin,
    signer: signer.publicKey,
  };

  await Promise.all([
    provider.onClientAuthorizationCallback(payload),
    provider.sendPayloadToProvider({
      rid,
      redirectOrigin,
    }),
  ]);

  return await provider.onClientAuthorizationCallback({
    phase: "complete",
    data: { type: "transaction", rid },
  });
}
