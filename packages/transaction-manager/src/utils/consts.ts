import { MULTI_WALLET_PROGRAM_ADDRESS } from "@revibase/core";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";

export const SECP256R1_VERIFY_PROGRAM =
  "Secp256r1SigVerify1111111111111111111111111";

export const WHITELISTED_PROGRAMS = new Set([
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  MULTI_WALLET_PROGRAM_ADDRESS,
  SECP256R1_VERIFY_PROGRAM,
  MEMO_PROGRAM_ADDRESS,
]);
