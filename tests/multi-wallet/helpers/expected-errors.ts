/**
 * Reference values for integration debugging — not asserted in every test.
 *
 * On a healthy local stack, failed `changeConfig` / multi-wallet instructions
 * often surface as `custom program error: #NNNN` where `NNNN` maps to
 * `packages/core/src/generated/errors/multiWallet.ts` (Anchor codes 6000+).
 *
 * Compressed transactions may also fail in CPI to Light Protocol first; the
 * reported code can differ from the multisig error you expect from program
 * logic alone.
 */
export const MW_PROGRAM_ERROR = {
  duplicateMember: "#6010",
  emptyMembers: "#6021",
  insufficientSignersWithVotePermission: "#6034",
  insufficientSignerWithInitiatePermission: "#6033",
  memberNotFound: "#6064",
  duplicateTransferIntent: "#6050",
} as const;

/** Thrown by `nativeTransferIntent` before RPC when vault balance is too low. */
export const NATIVE_TRANSFER_INSUFFICIENT_BALANCE =
  "Insufficient balance for native transfer.";
