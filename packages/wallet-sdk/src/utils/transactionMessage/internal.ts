import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  type Address,
  type AddressesByLookupTableAddress,
  fetchAddressesForLookupTables,
  type TransactionSigner,
} from "gill";
import {
  type CustomTransactionMessage,
  customTransactionMessageDeserialize,
} from ".";
import { getSolanaRpc } from "..";

function getAccountRole(
  message: CustomTransactionMessage,
  index: number,
  accountKey: Address,
  vaultPda: Address
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
  message: CustomTransactionMessage,
  index: number
) {
  const numAccountKeys = message.accountKeys.length;
  const { numSigners, numWritableSigners, numWritableNonSigners } = message;

  if (index >= numAccountKeys) {
    // `index` is not a part of static `accountKeys`.
    return false;
  }

  if (index < numWritableSigners) {
    // `index` is within the range of writable signer keys.
    return true;
  }

  if (index >= numSigners) {
    // `index` is within the range of non-signer keys.
    const indexIntoNonSigners = index - numSigners;
    // Whether `index` is within the range of writable non-signer keys.
    return indexIntoNonSigners < numWritableNonSigners;
  }

  return false;
}
function isSignerIndex(message: CustomTransactionMessage, index: number) {
  return index < message.numSigners;
}
/** Populate remaining accounts required for execution of the transaction. */

export async function accountsForTransactionExecute({
  multiWallet,
  transactionMessageBytes,
  addressesByLookupTableAddress,
  additionalSigners,
}: {
  transactionMessageBytes: Uint8Array;
  multiWallet: Address;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  additionalSigners?: TransactionSigner[];
}) {
  const transactionMessage = customTransactionMessageDeserialize(
    transactionMessageBytes
  );

  const addressLookupTableAccounts =
    addressesByLookupTableAddress ??
    (await fetchAddressesForLookupTables(
      transactionMessage.addressTableLookups.map((x) => x.accountKey),
      getSolanaRpc()
    ));

  // Populate account metas required for execution of the transaction.
  const accountMetas: (AccountMeta | AccountSignerMeta)[] = [];
  // First add the lookup table accounts used by the transaction. They are needed for on-chain validation.
  accountMetas.push(
    ...(transactionMessage.addressTableLookups?.map((lookup) => {
      return {
        role: AccountRole.READONLY,
        address: lookup.accountKey,
      };
    }) ?? [])
  );
  // Then add static account keys included into the message.
  for (const [
    accountIndex,
    accountKey,
  ] of transactionMessage.accountKeys.entries()) {
    accountMetas.push({
      address: accountKey,
      role: getAccountRole(
        transactionMessage,
        accountIndex,
        accountKey,
        multiWallet
      ),
    });
  }
  // Then add accounts that will be loaded with address lookup tables.
  for (const lookup of transactionMessage.addressTableLookups) {
    const lookupTableAccount = addressLookupTableAccounts[lookup.accountKey];
    if (!lookupTableAccount) {
      throw new Error(
        `Address lookup table account ${lookup.accountKey} not found`
      );
    }

    for (const accountIndex of lookup.writableIndexes) {
      const address = lookupTableAccount[accountIndex];
      if (!address) {
        throw new Error(
          `Address lookup table account ${lookup.accountKey} does not contain address at index ${accountIndex}`
        );
      }

      accountMetas.push({
        address,
        role: AccountRole.WRITABLE,
      });
    }
    for (const accountIndex of lookup.readonlyIndexes) {
      const address = lookupTableAccount[accountIndex];
      if (!address) {
        throw new Error(
          `Address lookup table account ${lookup.accountKey} does not contain address at index ${accountIndex}`
        );
      }
      accountMetas.push({
        address,
        role: AccountRole.READONLY,
      });
    }
  }

  for (const signer of additionalSigners?.filter(
    (x) => x.address !== multiWallet
  ) ?? []) {
    const index = accountMetas.findIndex(
      (meta) => meta.address === signer.address
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
    addressLookupTableAccounts,
    transactionMessage,
  };
}
