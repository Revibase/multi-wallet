import {
  Address,
  AddressesByLookupTableAddress,
  CompiledTransactionMessage,
  IInstruction,
} from "@solana/kit";
import { CompiledKeys } from "./compiled-keys";
import { MessageAccountKeys } from "./message-account-keys";

export function compileToWrappedMessageV0({
  payerKey,
  recentBlockhash,
  instructions,
  addressesByLookupTableAddress,
}: {
  payerKey: Address;
  recentBlockhash: string;
  instructions: IInstruction[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
}) {
  const compiledKeys = CompiledKeys.compile(instructions, payerKey);

  const addressTableLookups: {
    lookupTableAddress: Address;
    writableIndices: number[];
    readableIndices: number[];
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
      addressTableLookups.push(addressTableLookup);
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
