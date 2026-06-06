import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  type Address,
  type CompiledTransactionMessage,
  type CompiledTransactionMessageWithLifetime,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";
import { vaultTransactionMessageDeserialize } from "../../types";

function getAccountRole(
  message: CompiledTransactionMessage,
  index: number,
  accountKey: Address,
  vaultPda: Address,
) {
  const isWritable = isStaticWritableIndex(message, index);
  const isSigner = isSignerIndex(message, index) && accountKey !== vaultPda;
  if (isWritable && isSigner) {
    return AccountRole.WRITABLE_SIGNER;
  } else if (isWritable && !isSigner) {
    return AccountRole.WRITABLE;
  } else if (!isWritable && isSigner) {
    return AccountRole.READONLY_SIGNER;
  } else {
    return AccountRole.READONLY;
  }
}

function isStaticWritableIndex(
  message: CompiledTransactionMessage,
  index: number,
) {
  const numAccountKeys = message.staticAccounts.length;
  const {
    numSignerAccounts,
    numReadonlySignerAccounts,
    numReadonlyNonSignerAccounts,
  } = message.header;

  const numWritableSigners = numSignerAccounts - numReadonlySignerAccounts;
  const numWritableNonSigners =
    numAccountKeys - numSignerAccounts - numReadonlyNonSignerAccounts;

  if (index >= numAccountKeys) {
    return false;
  }

  if (index < numWritableSigners) {
    return true;
  }

  if (index >= numSignerAccounts) {
    const indexIntoNonSigners = index - numSignerAccounts;
    return indexIntoNonSigners < numWritableNonSigners;
  }

  return false;
}

function isSignerIndex(message: CompiledTransactionMessage, index: number) {
  return index < message.header.numSignerAccounts;
}

export async function accountsForTransactionExecute({
  walletAddress,
  transactionMessageBytes,
  additionalSigners,
}: {
  transactionMessageBytes: ReadonlyUint8Array;
  walletAddress: Address;
  additionalSigners?: TransactionSigner[];
}): Promise<{
  accountMetas: (AccountSignerMeta | AccountMeta)[];
  transactionMessage: CompiledTransactionMessage & {
    version: 1;
  } & CompiledTransactionMessageWithLifetime;
}> {
  const transactionMessage = vaultTransactionMessageDeserialize(
    transactionMessageBytes,
  );

  const accountMetas: (AccountMeta | AccountSignerMeta)[] = [];

  for (const [
    accountIndex,
    accountKey,
  ] of transactionMessage.staticAccounts.entries()) {
    accountMetas.push({
      address: accountKey,
      role: getAccountRole(
        transactionMessage,
        accountIndex,
        accountKey,
        walletAddress,
      ),
    });
  }

  for (const signer of additionalSigners?.filter(
    (x) => x.address !== walletAddress,
  ) ?? []) {
    const index = accountMetas.findIndex(
      (meta) => meta.address === signer.address,
    );
    if (index === -1) {
      accountMetas.push({
        address: signer.address,
        role: AccountRole.READONLY_SIGNER,
        signer,
      });
    } else {
      if (
        accountMetas[index].role === AccountRole.READONLY ||
        accountMetas[index].role === AccountRole.READONLY_SIGNER
      ) {
        accountMetas[index] = {
          address: signer.address,
          role: AccountRole.READONLY_SIGNER,
          signer,
        };
      } else if (
        accountMetas[index].role === AccountRole.WRITABLE ||
        accountMetas[index].role === AccountRole.WRITABLE_SIGNER
      ) {
        accountMetas[index] = {
          address: signer.address,
          role: AccountRole.WRITABLE_SIGNER,
          signer,
        };
      }
    }
  }

  return {
    accountMetas,
    transactionMessage,
  };
}
