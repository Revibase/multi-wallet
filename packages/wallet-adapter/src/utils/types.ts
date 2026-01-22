import {
  TransactionPayloadWithBase64MessageBytesSchema,
  type TransactionAuthenticationResponse,
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
    signer: z.string().optional(),
    data: z
      .object({
        type: z.literal("transaction"),
        payload: TransactionPayloadWithBase64MessageBytesSchema,
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
    signer: z.string().optional(),
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

export const CompleteCustomMessageRequestSchema = z.object({
  phase: z.literal("complete"),
  data: z.object({
    type: z.literal("message"),
    rid: z.string(),
  }),
});

export type CompleteCustomMessageRequest = z.infer<
  typeof CompleteCustomMessageRequestSchema
>;

export const CompleteCustomTransactionRequestSchema = z.object({
  phase: z.literal("complete"),
  data: z.object({
    type: z.literal("transaction"),
    rid: z.string(),
  }),
});

export type CompleteCustomTransactionRequest = z.infer<
  typeof CompleteCustomTransactionRequestSchema
>;

export type ClientAuthorizationCallback = {
  (request: StartCustomMessageRequest): Promise<{ rid: string }>;
  (request: StartCustomTransactionRequest): Promise<{ rid: string }>;
  (request: CompleteCustomMessageRequest): Promise<{
    user: User;
  }>;
  (
    request: CompleteCustomTransactionRequest,
  ): Promise<{ authResponse: TransactionAuthenticationResponse }>;
};
