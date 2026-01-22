import {
  TransactionActionTypeSchema,
  TransactionPayloadWithBase64MessageBytesSchema,
} from "@revibase/core";
import z from "zod";

export const UserSchema = z.looseObject({
  publicKey: z.string(),
  walletAddress: z.string(),
  settingsIndexWithAddress: z.object({
    index: z.number(),
    settingsAddressTreeIndex: z.number(),
  }),
  username: z.string().optional(),
  image: z.string().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const StartCustomTransactionRequestSchema = z
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
        rid: z.string(),
      })
      .strict(),
  })
  .strict();
export type StartCustomTransactionRequest = z.infer<
  typeof StartCustomTransactionRequestSchema
>;

export const StartCustomMessageRequestSchema = z
  .object({
    phase: z.literal("start"),
    redirectOrigin: z.string(),
    signer: UserSchema.optional(),
    data: z
      .object({
        type: z.literal("message"),
        rid: z.string(),
      })
      .strict(),
  })
  .strict();
export type StartCustomMessageRequest = z.infer<
  typeof StartCustomMessageRequestSchema
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
  (request: StartCustomMessageRequest): Promise<{ rid: string }>;
  (request: StartCustomTransactionRequest): Promise<{ rid: string }>;
  (request: CompleteMessageRequest): Promise<{ user: User }>;
  (request: CompleteTransactionRequest): Promise<{ txSig: string }>;
};
