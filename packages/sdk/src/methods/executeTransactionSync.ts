import { Address, Rpc, SolanaRpcApi, TransactionSigner } from "@solana/kit";
import { getTransactionExecuteSyncInstruction } from "../generated";
import { Secp256r1Key } from "../types";
import { getMultiWalletFromSettings } from "../utils";
import {
  accountsForTransactionExecute,
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/internal";

export async function executeTransactionSync({
  rpc,
  settings,
  transactionMessageBytes,
  signers,
}: {
  rpc: Rpc<SolanaRpcApi>;
  settings: Address;
  signers: (TransactionSigner | Secp256r1Key)[];
  transactionMessageBytes: Uint8Array;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);

  const multiWallet = await getMultiWalletFromSettings(settings);

  const { accountMetas, addressLookupTableAccounts, message } =
    await accountsForTransactionExecute({
      rpc,
      transactionMessageBytes,
      multiWallet,
      additionalSigners: dedupSigners.filter(
        (x) => !(x instanceof Secp256r1Key)
      ) as TransactionSigner[],
    });
  const { slotHashSysvar, domainConfig, verifyArgs } =
    extractSecp256r1VerificationArgs(
      dedupSigners.find((x) => x instanceof Secp256r1Key)
    );

  const transactionExecuteSyncIx = getTransactionExecuteSyncInstruction({
    domainConfig,
    slotHashSysvar,
    secp256r1VerifyArgs: verifyArgs,
    settings,
    numSigners: message.numSigners,
    numWritableSigners: message.numWritableSigners,
    numWritableNonSigners: message.numWritableNonSigners,
    numAccountKeys: message.accountKeys.length,
    instructions: message.instructions.map((x) => ({
      programIdIndex: x.programIdIndex,
      accountIndexes: new Uint8Array(x.accountIndexes),
      data: new Uint8Array(x.data),
    })),
    addressTableLookups: message.addressTableLookups.map((x) => ({
      accountKeyIndex: accountMetas.findIndex(
        (y) => y.address === x.accountKey
      ),
      writableIndexes: new Uint8Array(x.writableIndexes),
      readonlyIndexes: new Uint8Array(x.readonlyIndexes),
    })),
    remainingAccounts: accountMetas,
  });

  return {
    transactionExecuteSyncIx,
    addressLookupTableAccounts,
  };
}
