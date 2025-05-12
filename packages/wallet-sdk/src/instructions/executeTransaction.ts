import {
  Address,
  GetMultipleAccountsApi,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { getTransactionExecuteInstruction } from "../generated";
import { getMultiWalletFromSettings } from "../utils";
import { accountsForTransactionExecute } from "../utils/internal";

export async function executeTransaction({
  rpc,
  settings,
  transactionBufferAddress,
  transactionMessageBytes,
  feePayer,
  additionalSigners = [],
}: {
  rpc: Rpc<GetMultipleAccountsApi>;
  settings: Address;
  feePayer: TransactionSigner;
  transactionBufferAddress: Address;
  transactionMessageBytes: Uint8Array;
  additionalSigners?: TransactionSigner[];
}) {
  const multiWallet = await getMultiWalletFromSettings(settings);

  const { accountMetas, addressLookupTableAccounts } =
    await accountsForTransactionExecute({
      rpc,
      transactionMessageBytes,
      multiWallet,
      additionalSigners,
    });

  const transactionExecuteIx = getTransactionExecuteInstruction({
    transactionBuffer: transactionBufferAddress,
    payer: feePayer.address,
    remainingAccounts: accountMetas,
  });

  return {
    transactionExecuteIx,
    addressLookupTableAccounts,
  };
}
