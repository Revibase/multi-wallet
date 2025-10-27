import {
  getAddressEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";
import { signTransactionWithPasskey } from "../../passkeys";
import { type BasePayload } from "../../types";
import {
  fetchSettingsData,
  fetchUserAccountData,
  getSignedSecp256r1Key,
} from "../../utils";
import { resolveTransactionManagerSigner } from "../../utils/helper";
import { nativeTransferIntent } from "./nativeTransferIntent";
import { tokenTransferIntent } from "./tokenTransferIntent";

interface TransferIntentArgs extends BasePayload {
  amount: number | bigint;
  destination: Address;
  mint?: Address;
  tokenProgram?: Address;
  cachedAccounts?: Map<string, any>;
}

/**
 *
 * @param mint If no mint is provided, Native SOL will be used for the transfer
 * @returns
 */
export async function transferIntent({
  amount,
  destination,
  mint,
  tokenProgram = TOKEN_PROGRAM_ADDRESS,
  cachedAccounts = new Map<string, any>(),
  signer,
  popUp,
  authUrl,
  additionalInfo,
  debug,
}: TransferIntentArgs): Promise<Instruction[]> {
  const authResponse = await signTransactionWithPasskey({
    transactionActionType: "transfer_intent",
    transactionAddress: mint ? tokenProgram : SYSTEM_PROGRAM_ADDRESS,
    transactionMessageBytes: new Uint8Array([
      ...getU64Encoder().encode(amount),
      ...getAddressEncoder().encode(destination),
      ...getAddressEncoder().encode(mint ?? SYSTEM_PROGRAM_ADDRESS),
    ]),
    signer,
    popUp,
    authUrl,
    additionalInfo,
    debug,
  });
  const signedSigner = await getSignedSecp256r1Key(authResponse);
  let index: number;
  if (!authResponse.additionalInfo.settingsIndex) {
    const userAccountData = await fetchUserAccountData(
      signedSigner,
      cachedAccounts
    );
    if (userAccountData.settingsIndex.__option === "None") {
      throw Error("User has no delegated wallet");
    }
    index = Number(userAccountData.settingsIndex.value);
  } else {
    index = authResponse.additionalInfo.settingsIndex;
  }
  const settingsData = await fetchSettingsData(index, cachedAccounts);

  const transactionManagerSigner = await resolveTransactionManagerSigner({
    signer: signedSigner,
    index,
    cachedAccounts,
  });
  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];

  const instructions = mint
    ? await tokenTransferIntent({
        index,
        amount,
        signers,
        destination,
        mint,
        tokenProgram,
        compressed: settingsData.isCompressed,
        cachedAccounts,
      })
    : await nativeTransferIntent({
        index,
        amount,
        signers,
        destination,
        compressed: settingsData.isCompressed,
        cachedAccounts,
      });

  return instructions;
}
