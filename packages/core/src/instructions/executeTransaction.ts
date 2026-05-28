import type {
  Address,
  AddressesByLookupTableAddress,
  Instruction,
  ReadonlyUint8Array,
  TransactionSigner,
} from "@solana/kit";
import { getTransactionExecuteInstruction } from "../generated";
import { getWalletAddressFromSettings } from "../utils";
import { addJitoTip } from "../utils/transaction/internal";
import { accountsForTransactionExecute } from "../utils/transactionMessage/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function executeTransaction({
  settings,
  transactionBufferAddress,
  transactionMessageBytes,
  payer,
  addressesByLookupTableAddress,
  secp256r1VerifyInput = [],
  additionalSigners = [],
  jitoBundlesTipAmount,
}: {
  settings: Address;
  payer: TransactionSigner;
  transactionBufferAddress: Address;
  transactionMessageBytes: ReadonlyUint8Array;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  additionalSigners?: TransactionSigner[];
  jitoBundlesTipAmount?: number;
}) {
  const walletAddress = await getWalletAddressFromSettings(settings);

  const { accountMetas, addressLookupTableAccounts } =
    await accountsForTransactionExecute({
      transactionMessageBytes,
      walletAddress,
      additionalSigners,
      addressesByLookupTableAddress,
    });

  const instructions: Instruction[] = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  instructions.push(
    getTransactionExecuteInstruction({
      transactionBuffer: transactionBufferAddress,
      payer: payer.address,
      remainingAccounts: accountMetas,
      settings,
    }),
  );

  if (jitoBundlesTipAmount) {
    instructions.push(addJitoTip({ payer, tipAmount: jitoBundlesTipAmount }));
  }

  return {
    instructions,
    addressLookupTableAccounts,
  };
}
