import type {
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "@solana/kit";

export type TransactionDetails = {
  payer: TransactionSigner;
  instructions: Instruction[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
};
