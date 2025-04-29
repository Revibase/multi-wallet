import { getTransferSolInstruction } from "@solana-program/system";
import { address, TransactionSigner } from "@solana/kit";
import { JITO_TIP_ACCOUNTS } from "../utils/consts";

export function addJitoTip({
  feePayer,
  tipAmount,
}: {
  feePayer: TransactionSigner;
  tipAmount: number;
}) {
  const tipAccount =
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return getTransferSolInstruction({
    source: feePayer,
    destination: address(tipAccount),
    amount: tipAmount,
  });
}
