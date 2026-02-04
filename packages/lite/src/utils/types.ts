import type {
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
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
  (request: CompleteMessageRequest): Promise<{ user: User }>;
  (request: CompleteTransactionRequest): Promise<{ txSig: string }>;
};
