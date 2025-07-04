import { Address, IInstruction, TransactionSigner } from "@solana/kit";
import {
  getTransactionExecuteCompressedInstruction,
  getTransactionExecuteInstruction,
} from "../generated";
import { getMultiWalletFromSettings, getSettingsFromIndex } from "../utils";
import { accountsForTransactionExecute, addJitoTip } from "../utils/internal";
import {
  getSecp256r1VerifyInstruction,
  Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function executeTransaction({
  index,
  transactionBufferAddress,
  transactionMessageBytes,
  payer,
  secp256r1VerifyInput = [],
  additionalSigners = [],
  jitoBundlesTipAmount,
  compressed = false,
}: {
  index: bigint | number;
  payer: TransactionSigner;
  transactionBufferAddress: Address;
  transactionMessageBytes: Uint8Array;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  additionalSigners?: TransactionSigner[];
  jitoBundlesTipAmount?: number;
  compressed?: boolean;
}) {
  const settings = await getSettingsFromIndex(index);
  const multiWallet = await getMultiWalletFromSettings(settings);

  const { accountMetas, addressLookupTableAccounts } =
    await accountsForTransactionExecute({
      transactionMessageBytes,
      multiWallet,
      additionalSigners,
    });

  const instructions: IInstruction[] = [];
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
