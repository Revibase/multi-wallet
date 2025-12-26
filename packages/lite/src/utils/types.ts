import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";

export type User = {
  publicKey: string;
  walletAddress: string;
  settingsIndexWithAddress: {
    index: number | bigint;
    settingsAddressTreeIndex: number;
  };
  hasTxManager: boolean;
  username?: string;
  image?: string;
};

export type ClientAuthorizationCallback = {
  (
    request: StartMessageRequest
  ): Promise<{ id?: string; message: string; signature: string }>;
  (request: StartTransactionRequest): Promise<{ signature: string }>;
  (request: CompleteMessageRequest): Promise<{ user: User }>;
  (request: CompleteTransactionRequest): Promise<{ txSig: string }>;
};
