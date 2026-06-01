import type { CompleteMessageRequest } from "@revibase/core";
import { fetchSignaturesFromTransactionManager } from "@revibase/core";
import type { SignInAuthorizationFlowOptions } from "../types";

export async function fetchSignatureFromTransactionManager({
  data,
  url,
  options,
}: {
  data: {
    publicKey: string;
    payload: CompleteMessageRequest;
  };
  url: string;
  options?: SignInAuthorizationFlowOptions;
}): Promise<string> {
  const signatures = await fetchSignaturesFromTransactionManager({
    url,
    payload: JSON.stringify({ type: "message", data }),
    expectedSignatureCount: 1,
    callbacks: {
      onPendingApprovalsCallback:
        options?.pendingApprovalsCallback?.onPendingApprovalsCallback,
      onPendingApprovalsSuccess:
        options?.pendingApprovalsCallback?.onPendingApprovalsSuccess,
    },
    abortSignal: options?.signal,
  });

  return signatures[0]!;
}
