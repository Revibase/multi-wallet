import {
  address,
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
  settings: string;
  feePayer: TransactionSigner;
  transactionBufferAddress: string;
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
    transactionBuffer: address(transactionBufferAddress),
    payer: address(feePayer.address),
    remainingAccounts: accountMetas,
  });

  return {
    transactionExecuteIx,
    addressLookupTableAccounts,
  };
}
