import type {
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";
import z from "zod";

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
  (request: StartTransactionRequest): Promise<{ rid: string }>;
  (request: CompleteMessageRequest): Promise<{ user: UserInfo }>;
  (
    request: CompleteTransactionRequest,
  ): Promise<{ txSig: string; user: UserInfo }>;
};
