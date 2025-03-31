import { PublicKey, SystemProgram } from "@solana/web3.js";
import { JITO_TIP_ACCOUNTS } from "../utils";

export async function addJitoTip({
  feePayer,
  tipAmount,
}: {
  feePayer: PublicKey;
  tipAmount: number;
}) {
  const tipAccount =
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return SystemProgram.transfer({
    fromPubkey: feePayer,
    toPubkey: new PublicKey(tipAccount),
    lamports: tipAmount,
  });
}
