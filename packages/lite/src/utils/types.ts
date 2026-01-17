import {
  TransactionActionTypeSchema,
  TransactionPayloadWithBase64MessageBytesSchema,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type StartMessageRequest,
  type TransactionPayloadWithBase64MessageBytes,
} from "@revibase/core";
import z from "zod";

export const UserSchema = z.object({
  publicKey: z.string(),
  walletAddress: z.string(),
  settingsIndexWithAddress: z.object({
    index: z.number(),
    settingsAddressTreeIndex: z.number(),
  }),
  username: z.string(),
  image: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const StartTransactionRequestWithOptionalTypeSchema = z
  .object({
    phase: z.literal("start"),
    redirectOrigin: z.string(),
    signer: UserSchema.optional(),
    data: z
      .object({
        type: z.literal("transaction"),
        payload: TransactionPayloadWithBase64MessageBytesSchema.extend({
          transactionActionType: TransactionActionTypeSchema.optional(),
          transactionAddress: z.string().optional(),
        }),
      })
      .strict(),
  })
  .strict();
export type StartTransactionRequestWithOptionalType = z.infer<
  typeof StartTransactionRequestWithOptionalTypeSchema
>;

export type ClientAuthorizationCallback = {
  (
    request: StartMessageRequest,
  ): Promise<{ id?: string; message: string; signature: string }>;
  (request: StartTransactionRequestWithOptionalType): Promise<{
    signature: string;
    transactionPayload: TransactionPayloadWithBase64MessageBytes;
  }>;
  (request: CompleteMessageRequest): Promise<{ user: User }>;
  (request: CompleteTransactionRequest): Promise<{ txSig: string }>;
};
