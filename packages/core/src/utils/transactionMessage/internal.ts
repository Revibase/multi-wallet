import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  type Address,
  type AddressesByLookupTableAddress,
  type CompiledTransactionMessage,
  fetchAddressesForLookupTables,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "gill";
import { getSolanaRpc } from "..";
import { vaultTransactionMessageDeserialize } from "../../types";

/**
 * Determines the account role based on message structure and account key
 * @param message - Compiled transaction message
 * @param index - Account index in the message
 * @param accountKey - Account address
 * @param vaultPda - Vault PDA address (never treated as signer)
 * @returns Account role (writable/readonly, signer/non-signer)
 */
function getAccountRole(
  message: CompiledTransactionMessage,
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

/**
 * Checks if an account index corresponds to a writable account in the static account keys
 * @param message - Compiled transaction message
 * @param index - Account index
 * @returns True if the account is writable
 */
function isStaticWritableIndex(
  message: CompiledTransactionMessage,
  index: number
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
    // `index` is not a part of static `accountKeys`.
    return false;
  }

  if (index < numWritableSigners) {
    // `index` is within the range of writable signer keys.
    return true;
  }

  if (index >= numSignerAccounts) {
    // `index` is within the range of non-signer keys.
    const indexIntoNonSigners = index - numSignerAccounts;
    // Whether `index` is within the range of writable non-signer keys.
    return indexIntoNonSigners < numWritableNonSigners;
  }

  return false;
}
/**
 * Checks if an account index corresponds to a signer account
 * @param message - Compiled transaction message
 * @param index - Account index
 * @returns True if the account is a signer
 */
function isSignerIndex(message: CompiledTransactionMessage, index: number) {
  return index < message.header.numSignerAccounts;
}

/**
 * Populates all accounts required for transaction execution
 * Includes lookup table accounts, static accounts, and additional signers
 * @param params - Transaction execution parameters
 * @returns Account metas, lookup table accounts, and deserialized transaction message
 * @throws {Error} If lookup table account or address is missing
 */
export async function accountsForTransactionExecute({
  walletAddress,
  transactionMessageBytes,
  addressesByLookupTableAddress,
  additionalSigners,
}: {
  transactionMessageBytes: ReadonlyUint8Array;
  walletAddress: Address;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  additionalSigners?: TransactionSigner[];
}) {
  const transactionMessage = vaultTransactionMessageDeserialize(
    transactionMessageBytes
  );

  if (transactionMessage.version === "legacy") {
    throw new Error("Only versioned transaction is allowed.");
  }

  const addressLookupTableAccounts =
    addressesByLookupTableAddress ??
    (transactionMessage.addressTableLookups
      ? await fetchAddressesForLookupTables(
          transactionMessage.addressTableLookups.map(
            (x) => x.lookupTableAddress
          ),
          getSolanaRpc()
        )
      : {});

  const accountMetas: (AccountMeta | AccountSignerMeta)[] = [];

  // Add lookup table accounts first (required for on-chain validation)
  accountMetas.push(
    ...(transactionMessage.addressTableLookups?.map((lookup) => {
      return {
        role: AccountRole.READONLY,
        address: lookup.lookupTableAddress,
      };
    }) ?? [])
  );

  // Add static account keys from the message
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
        walletAddress
      ),
    });
  }

  // Add accounts loaded via address lookup tables
  if (transactionMessage.addressTableLookups) {
    for (const lookup of transactionMessage.addressTableLookups) {
      const lookupTableAccount =
        addressLookupTableAccounts[lookup.lookupTableAddress];
      if (!lookupTableAccount) {
        throw new Error(
          `Address lookup table account ${lookup.lookupTableAddress} not found`
        );
      }

      for (const accountIndex of lookup.writableIndexes) {
        const address = lookupTableAccount[accountIndex];
        if (!address) {
          throw new Error(
            `Address lookup table account ${lookup.lookupTableAddress} does not contain address at index ${accountIndex}`
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
            `Address lookup table account ${lookup.lookupTableAddress} does not contain address at index ${accountIndex}`
          );
        }
        accountMetas.push({
          address,
          role: AccountRole.READONLY,
        });
      }
    }
  }

  for (const signer of additionalSigners?.filter(
    (x) => x.address !== walletAddress
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
