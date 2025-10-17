import type {
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "gill";

export type BundleResponse = {
  id:
    | "Create Transaction Buffer"
    | "Extend Transaction Buffer"
    | "Vote Transaction"
    | "Execute Transaction Approval"
    | "Execute Transaction"
    | "Execute Transaction Sync";
  payer: TransactionSigner;
  ixs: Instruction[];
  addressLookupTableAccounts?: AddressesByLookupTableAddress;
};
