import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  TransactionActionType,
  TransactionPayloadWithBase64MessageBytes,
} from "@revibase/core";

export type User = {
  publicKey: string;
  walletAddress: string;
  settingsIndexWithAddress: {
    index: number | bigint;
    settingsAddressTreeIndex: number;
  };
  username?: string;
  image?: string;
};

export type StartTransactionRequestWithOptionalType = {
  phase: "start";
  redirectOrigin: string;
  signer?: User;
  data: {
    type: "transaction";
    payload: Omit<
      TransactionPayloadWithBase64MessageBytes,
      "transactionActionType" | "transactionAddress"
    > & {
      transactionActionType?: TransactionActionType;
      transactionAddress?: string;
    };
  };
};

export type ClientAuthorizationCallback = {
  (
    request: StartMessageRequest
  ): Promise<{ id?: string; message: string; signature: string }>;
  (request: StartTransactionRequestWithOptionalType): Promise<{
    signature: string;
    transactionPayload: TransactionPayloadWithBase64MessageBytes;
  }>;
  (request: CompleteMessageRequest): Promise<{ user: User }>;
  (request: CompleteTransactionRequest): Promise<{ txSig: string }>;
};
