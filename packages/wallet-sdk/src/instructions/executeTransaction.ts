import {
  Address,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { getTransactionExecuteInstruction } from "../generated";
import { getMultiWalletFromSettings } from "../utils";
import { accountsForTransactionExecute, addJitoTip } from "../utils/internal";
import {
  getSecp256r1VerifyInstruction,
  Secp256r1VerifyInput,
} from "./secp256r1Verify";

export async function executeTransaction({
  rpc,
  settings,
  transactionBufferAddress,
  transactionMessageBytes,
  feePayer,
  secp256r1VerifyInput = [],
  additionalSigners = [],
  jitoBundlesTipAmount,
}: {
  rpc: Rpc<GetMultipleAccountsApi>;
  settings: Address;
  feePayer: TransactionSigner;
  transactionBufferAddress: Address;
  transactionMessageBytes: Uint8Array;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  additionalSigners?: TransactionSigner[];
  jitoBundlesTipAmount?: number;
}) {
  const multiWallet = await getMultiWalletFromSettings(settings);

  const { accountMetas, addressLookupTableAccounts } =
    await accountsForTransactionExecute({
      rpc,
      transactionMessageBytes,
      multiWallet,
      additionalSigners,
    });

  const instructions: IInstruction[] = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }

  instructions.push(
    getTransactionExecuteInstruction({
      transactionBuffer: transactionBufferAddress,
      payer: feePayer.address,
      remainingAccounts: accountMetas,
      settings,
    })
  );

  if (jitoBundlesTipAmount) {
    instructions.push(
      addJitoTip({ feePayer, tipAmount: jitoBundlesTipAmount })
    );
  }

  return {
    instructions,
    addressLookupTableAccounts,
  };
}
