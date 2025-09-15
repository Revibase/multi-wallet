import {
  Address,
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "@solana/kit";
import {
  getTransactionExecuteCompressedInstruction,
  getTransactionExecuteInstruction,
} from "../generated";
import { getMultiWalletFromSettings } from "../utils";
import {
  accountsForTransactionExecute,
  addJitoTip,
} from "../utils/transactionMessage/internal";
import {
  getSecp256r1VerifyInstruction,
  Secp256r1VerifyInput,
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
  compressed = false,
}: {
  settings: Address;
  payer: TransactionSigner;
  transactionBufferAddress: Address;
  transactionMessageBytes: Uint8Array;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  additionalSigners?: TransactionSigner[];
  jitoBundlesTipAmount?: number;
  compressed?: boolean;
}) {
  const multiWallet = await getMultiWalletFromSettings(settings);

  const { accountMetas, addressLookupTableAccounts } =
    await accountsForTransactionExecute({
      transactionMessageBytes,
      multiWallet,
      additionalSigners,
      addressesByLookupTableAddress,
    });

  const instructions: Instruction[] = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  instructions.push(
    compressed
      ? getTransactionExecuteCompressedInstruction({
          transactionBuffer: transactionBufferAddress,
          payer: payer.address,
          remainingAccounts: accountMetas,
          settingsKey: settings,
        })
      : getTransactionExecuteInstruction({
          transactionBuffer: transactionBufferAddress,
          payer: payer.address,
          remainingAccounts: accountMetas,
          settings,
        })
  );

  if (jitoBundlesTipAmount) {
    instructions.push(addJitoTip({ payer, tipAmount: jitoBundlesTipAmount }));
  }

  return {
    instructions,
    addressLookupTableAccounts,
  };
}
