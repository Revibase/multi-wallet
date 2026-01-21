import {
  TransactionActionTypeSchema,
  TransactionPayloadWithBase64MessageBytesSchema,
  type StartMessageRequest,
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

export const CompleteMessageRequestSchema = z.object({
  phase: z.literal("complete"),
  data: z.object({
    type: z.literal("message"),
    rid: z.string(),
  }),
});

export type CompleteMessageRequest = z.infer<
  typeof CompleteMessageRequestSchema
>;

export const CompleteTransactionRequestSchema = z.object({
  phase: z.literal("complete"),
  data: z.object({
    type: z.literal("transaction"),
    rid: z.string(),
  }),
});

export type CompleteTransactionRequest = z.infer<
  typeof CompleteTransactionRequestSchema
>;

export type ClientAuthorizationCallback = {
  (request: StartMessageRequest): Promise<{ rid: string }>;
  (request: StartTransactionRequestWithOptionalType): Promise<{ rid: string }>;
  (request: CompleteMessageRequest): Promise<{ user: User }>;
  (request: CompleteTransactionRequest): Promise<{ txSig: string }>;
};
