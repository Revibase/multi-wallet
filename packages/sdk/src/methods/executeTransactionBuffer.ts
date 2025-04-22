import { Address, Rpc, SolanaRpcApi, TransactionSigner } from "@solana/kit";
import { getTransactionBufferExecuteInstruction } from "../generated";
import { Secp256r1Key } from "../types";
import { getMultiWalletFromSettings } from "../utils";
import {
  accountsForTransactionExecute,
  extractSecp256r1VerificationArgs,
} from "../utils/private";

export async function executeTransactionBuffer({
  rpc,
  settings,
  executor,
  transactionBufferAddress,
  transactionMessageBytes,
  feePayer,
  additionalSigners = [],
}: {
  rpc: Rpc<SolanaRpcApi>;
  settings: Address;
  feePayer: TransactionSigner;
  executor: TransactionSigner | Secp256r1Key;
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

  const { slotHashSysvar, domainConfig, verifyArgs } =
    extractSecp256r1VerificationArgs(executor);
  const transactionBufferExecuteIx = getTransactionBufferExecuteInstruction({
    slotHashSysvar,
    settings,
    rentPayer: feePayer.address,
    transactionBuffer: transactionBufferAddress,
    secp256r1VerifyArgs: verifyArgs,
    domainConfig,
    executor: executor instanceof Secp256r1Key ? undefined : executor,
    remainingAccounts: accountMetas,
  });

  return {
    transactionBufferExecuteIx,
    addressLookupTableAccounts,
  };
}
