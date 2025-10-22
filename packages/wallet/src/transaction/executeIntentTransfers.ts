import {
  getAddressEncoder,
  getU64Encoder,
  type Address,
  type AddressesByLookupTableAddress,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";
import { nativeTransferIntent } from "../instructions/intents/nativeTransferIntent";
import { tokenTransferIntent } from "../instructions/intents/tokenTransferIntent";
import { signTransaction } from "../passkeys";
import { Secp256r1Key, type BasePayload } from "../types";
import { fetchSettingsData, fetchUserAccountData, getFeePayer } from "../utils";
import { sendNonBundleTransaction } from "../utils/adapter";
import { resolveTransactionManagerSigner } from "../utils/helper";

interface TransferIntentArgs extends BasePayload {
  amount: number | bigint;
  destination: Address;
  network?: "mainnet" | "devnet";
  mint?: Address;
  tokenProgram?: Address;
  cachedAccounts?: Map<string, any>;
  addressByLookUpTableAddress?: AddressesByLookupTableAddress;
}

/**
 *
 * @param mint If no mint is provided, Native SOL will be used for the transfer
 * @returns
 */
export async function executeIntentTransfers({
  destination,
  amount,
  mint,
  tokenProgram = TOKEN_PROGRAM_ADDRESS,
  hints,
  signer,
  popUp,
  addressByLookUpTableAddress,
  cachedAccounts = new Map<string, any>(),
}: TransferIntentArgs) {
  const signedTx = await signTransaction({
    transactionActionType: "transfer_intent",
    transactionAddress: mint ? tokenProgram : SYSTEM_PROGRAM_ADDRESS,
    transactionMessageBytes: new Uint8Array([
      ...getU64Encoder().encode(amount),
      ...getAddressEncoder().encode(destination),
      ...getAddressEncoder().encode(mint ?? SYSTEM_PROGRAM_ADDRESS),
    ]),
    hints,
    signer,
    popUp,
  });
  let index: number;
  if (
    !signedTx.additionalInfo?.walletAddress ||
    !signedTx.additionalInfo.settingsIndex
  ) {
    const userAccountData = await fetchUserAccountData(
      new Secp256r1Key(signedTx.signer),
      cachedAccounts
    );
    if (userAccountData.settingsIndex.__option === "None") {
      throw Error("User has no delegated wallet");
    }
    index = Number(userAccountData.settingsIndex.value);
  } else {
    index = signedTx.additionalInfo.settingsIndex;
  }
  const [settingsData, payer] = await Promise.all([
    fetchSettingsData(index, cachedAccounts),
    getFeePayer(),
  ]);
  const transactionManagerSigner = await resolveTransactionManagerSigner({
    member: signedTx.signer,
    index,
    cachedAccounts,
  });
  const primarySigner = new Secp256r1Key(signedTx.signer, signedTx);
  const signers = transactionManagerSigner
    ? [primarySigner, transactionManagerSigner]
    : [primarySigner];

  const ixs = mint
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

  return await sendNonBundleTransaction(
    ixs,
    payer,
    addressByLookUpTableAddress
  );
}
