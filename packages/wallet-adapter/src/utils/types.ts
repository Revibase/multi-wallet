import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";

export type ClientAuthorizationCallback = {
  (
    request: StartMessageRequest
  ): Promise<{ id?: string; message: string; signature: string }>;
  (request: StartTransactionRequest): Promise<{ signature: string }>;
  (request: CompleteMessageRequest): Promise<{
    user: {
      publicKey: string;
      walletAddress: string;
      settingsIndexWtihAddress: {
        index: number | bigint;
        settingsAddressTreeIndex: number;
      };
      hasTxManager: boolean;
      username?: string;
      image?: string;
    };
  }>;
  (request: CompleteTransactionRequest): Promise<{ signature: string }>;
};
