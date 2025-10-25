import type {
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "gill";

export type TransactionDetails = {
  payer: TransactionSigner;
  instructions: Instruction[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
};
