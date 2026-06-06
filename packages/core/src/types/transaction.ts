import type { Instruction, TransactionSigner } from "@solana/kit";

export type TransactionDetails = {
  payer: TransactionSigner;
  instructions: Instruction[];
};
