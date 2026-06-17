import type { CompleteMessageRequest } from "@revibase/core";
import { fetchSignaturesFromTransactionManager } from "@revibase/core";
import type { InternalMessageFlowOptions } from "../types";

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
  options?: InternalMessageFlowOptions;
}): Promise<string> {
  const signatures = await fetchSignaturesFromTransactionManager({
    url,
    payload: JSON.stringify({ type: "message", data }),
    expectedSignatureCount: 1,
    callbacks: {
      onPendingApprovalsCallback: (validTill) =>
        options?.reportStatus?.({ phase: "pending_approval", validTill }),
      onPendingApprovalsSuccess: () =>
        options?.reportStatus?.({ phase: "approved" }),
    },
    abortSignal: options?.signal,
  });

  return signatures[0]!;
}
