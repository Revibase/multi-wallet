/**
 * Passed through to {@link getTransactionManagerSigner} when the transaction
 * manager may require approval on a trusted device before signing.
 */
export type PendingApprovalsCallbacks = {
  onPendingApprovalsCallback?: (validTill: number) => void;
  onPendingApprovalsSuccess?: () => void;
};
