import type {
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import { type TransactionAuthenticationResponse } from "@revibase/core";
import z from "zod";

export const UserSchema = z.looseObject({
  publicKey: z.string(),
  walletAddress: z.string(),
  settingsIndexWithAddress: z.object({
    index: z.union([z.number(), z.bigint()]),
    settingsAddressTreeIndex: z.number(),
  }),
  username: z.string().optional(),
  image: z.string().optional(),
});
export type User = z.infer<typeof UserSchema>;

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
  (request: StartMessageRequest): Promise<{ rid: string }>;
  (request: StartTransactionRequest): Promise<{ rid: string }>;
  (request: CompleteCustomMessageRequest): Promise<{
    user: User;
  }>;
  (
    request: CompleteCustomTransactionRequest,
  ): Promise<{ authResponse: TransactionAuthenticationResponse }>;
};
