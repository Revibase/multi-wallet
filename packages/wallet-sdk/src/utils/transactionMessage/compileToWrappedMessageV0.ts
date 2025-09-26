import {
  address,
  type Address,
  type AddressesByLookupTableAddress,
  type CompiledTransactionMessage,
  type Instruction,
} from "gill";
import { CompiledKeys } from "./compiled-keys";
import { MessageAccountKeys } from "./message-account-keys";

export function compileToWrappedMessageV0({
  payer,
  recentBlockhash,
  instructions,
  addressesByLookupTableAddress,
}: {
  payer: Address;
  recentBlockhash: string;
  instructions: Instruction[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
}) {
  const compiledKeys = CompiledKeys.compile(instructions, payer);

  const addressTableLookups: {
    /** The address of the address lookup table account. */
    lookupTableAddress: Address;
    /** @deprecated Use `readonlyIndexes` */
    readableIndices: readonly number[];
    /** Indexes of accounts in a lookup table to load as read-only. */
    readonlyIndexes: readonly number[];
    /** Indexes of accounts in a lookup table to load as writable. */
    writableIndexes: readonly number[];
    /** @deprecated Use `writableIndexes` */
    writableIndices: readonly number[];
  }[] = new Array();
  const accountKeysFromLookups: { writable: Address[]; readonly: Address[] } = {
    writable: [],
    readonly: [],
  };
  const lookupTableAccounts = Object.entries(
    addressesByLookupTableAddress ?? {}
  );

  for (const lookupTable of lookupTableAccounts) {
    const extractResult = compiledKeys.extractTableLookup(lookupTable);
    if (extractResult !== undefined) {
      const { addressTableLookup, drainedKeys } = extractResult;
      addressTableLookups.push({
        readonlyIndexes: addressTableLookup.readonlyIndexes,
        readableIndices: addressTableLookup.readonlyIndexes,
        writableIndexes: addressTableLookup.writableIndexes,
        writableIndices: addressTableLookup.writableIndexes,
        lookupTableAddress: address(addressTableLookup.lookupTableAddress),
      });
      accountKeysFromLookups.writable.push(...drainedKeys.writable);
      accountKeysFromLookups.readonly.push(...drainedKeys.readonly);
    }
  }

  const [header, staticAccounts] = compiledKeys.getMessageComponents();

  const accountKeys = new MessageAccountKeys(
    staticAccounts,
    accountKeysFromLookups
  );

  const compiledInstructions = accountKeys.compileInstructions(instructions);
  return {
    version: 0,
    header,
    instructions: compiledInstructions,
    lifetimeToken: recentBlockhash,
    staticAccounts,
    addressTableLookups,
  } as CompiledTransactionMessage;
}
