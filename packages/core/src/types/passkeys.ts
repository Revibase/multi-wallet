import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import z from "zod";

export const TransactionActionTypeSchema = z.enum([
  "create",
  "create_with_preauthorized_execution",
  "execute",
  "vote",
  "sync",
  "close",
  "decompress",
  "transfer_intent",
  "change_delegate",
  "change_config",
]);

export const TransactionPayloadSchema = z
  .object({
    transactionActionType: TransactionActionTypeSchema,
    transactionAddress: z.string(),
    transactionMessageBytes: z
      .array(z.number().int().min(0).max(255))
      .transform((arr) => new Uint8Array(arr)),
  })
  .strict();

export const TransactionPayloadWithBase64MessageBytesSchema = z
  .object({
    transactionActionType: TransactionActionTypeSchema,
    transactionAddress: z.string(),
    transactionMessageBytes: z.string(),
  })
  .strict();

const AuthenticationContextSchema = z
  .object({
    authResponse: z.custom<AuthenticationResponseJSON>(),
    nonce: z.string(),
    clientSignature: z
      .object({
        clientOrigin: z.string(),
        signature: z.string(),
      })
      .strict(),
    deviceSignature: z
      .object({
        publicKey: z.string(),
        signature: z.string(),
      })
      .strict(),
    authProviderSignature: z
      .object({
        publicKey: z.string(),
        signature: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();

const BaseResponseSchema = z
  .object({
    signer: z.string(),
    userAddressTreeIndex: z.number().optional(),
    additionalInfo: z.looseObject({}),
  })
  .strict();

const TransactionDetailsSchema = z
  .object({
    transactionPayload: TransactionPayloadWithBase64MessageBytesSchema,
    slotHash: z.string(),
    slotNumber: z.string(),
    originIndex: z.number(),
    crossOrigin: z.boolean(),
  })
  .strict();

type TransactionDetails = z.infer<typeof TransactionDetailsSchema>;

export const StartMessageRequestSchema = z
  .object({
    phase: z.literal("start"),
    redirectOrigin: z.url(),
    signer: z.string().optional(),
    data: z
      .object({
        type: z.literal("message"),
        payload: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const StartTransactionRequestSchema = z
  .object({
    phase: z.literal("start"),
    redirectOrigin: z.url(),
    signer: z.string().optional(),
    data: z
      .object({
        type: z.literal("transaction"),
        payload: TransactionPayloadWithBase64MessageBytesSchema,
      })
      .strict(),
  })
  .strict();

export const CompleteMessageRequestSchema = z
  .object({
    phase: z.literal("complete"),
    data: z
      .object({
        type: z.literal("message"),
        payload: BaseResponseSchema.extend(
          AuthenticationContextSchema.shape
        ).extend({
          id: z.string().optional(),
          message: z.string(),
          clientSignature: z
            .object({
              clientOrigin: z.string(),
            })
            .strict(),
        }),
      })
      .strict(),
  })
  .strict();

export const CompleteTransactionRequestSchema = z
  .object({
    phase: z.literal("complete"),
    data: z
      .object({
        type: z.literal("transaction"),
        payload: BaseResponseSchema.extend(AuthenticationContextSchema.shape)
          .extend(TransactionDetailsSchema.shape)
          .extend({
            clientSignature: z
              .object({
                clientOrigin: z.string(),
              })
              .strict(),
          }),
      })
      .strict(),
  })
  .strict();

export type TransactionActionType = z.infer<typeof TransactionActionTypeSchema>;
export type TransactionPayload = z.infer<typeof TransactionPayloadSchema>;
export type TransactionPayloadWithBase64MessageBytes = z.infer<
  typeof TransactionPayloadWithBase64MessageBytesSchema
>;
export type StartMessageRequest = z.infer<typeof StartMessageRequestSchema>;
export type StartTransactionRequest = z.infer<
  typeof StartTransactionRequestSchema
>;
export type CompleteTransactionRequest = z.infer<
  typeof CompleteTransactionRequestSchema
>;
export type CompleteMessageRequest = z.infer<
  typeof CompleteMessageRequestSchema
>;

type AuthenticationContext = z.infer<typeof AuthenticationContextSchema>;
type BaseResponse = z.infer<typeof BaseResponseSchema>;
export type TransactionAuthenticationResponse = TransactionDetails &
  AuthenticationContext &
  BaseResponse;
export type MessageAuthenticationResponse = AuthenticationContext &
  BaseResponse;
export type TransactionAuthDetails = TransactionDetails & AuthenticationContext;
