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
    transactionMessageBytes: z.base64(),
  })
  .strict();

export const StartMessageRequestSchema = z
  .object({
    phase: z.literal("start"),
    redirectOrigin: z.url(),
    signer: z.string().optional(),
    rid: z.string(),
    validTill: z.number(),
    data: z
      .object({
        type: z.literal("message"),
        payload: z.string(),
      })
      .strict(),
  })
  .strict();

export const StartTransactionRequestSchema = z
  .object({
    phase: z.literal("start"),
    redirectOrigin: z.url(),
    signer: z.string().optional(),
    rid: z.string(),
    validTill: z.number(),
    data: z
      .object({
        type: z.literal("transaction"),
        payload: TransactionPayloadWithBase64MessageBytesSchema,
        sendTx: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const AuthenticationContextSchema = z
  .object({
    startRequest: z.union([
      StartMessageRequestSchema,
      StartTransactionRequestSchema,
    ]),
    authResponse: z.custom<AuthenticationResponseJSON>(),
    client: z
      .object({
        clientOrigin: z.url(),
        jws: z.string(),
      })
      .strict(),
    device: z
      .object({
        jwk: z.base64(),
        jws: z.string(),
      })
      .strict(),
    authProvider: z
      .object({
        jwk: z.base64(),
        jws: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const BaseResponseSchema = z
  .object({
    signer: z.string(),
    userAddressTreeIndex: z.number().optional(),
    additionalInfo: z.looseObject({}).optional(),
  })
  .strict();

export const TransactionDetailsSchema = z
  .object({
    slotHash: z.string(),
    slotNumber: z.string(),
    originIndex: z.number(),
    crossOrigin: z.boolean(),
  })
  .strict();

export const CompleteMessageRequestSchema = z
  .object({
    phase: z.literal("complete"),
    data: z
      .object({
        type: z.literal("message"),
        payload: BaseResponseSchema.extend(
          AuthenticationContextSchema.shape,
        ).extend({
          id: z.string().optional(),
          client: z
            .object({
              clientOrigin: z.url(),
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
            client: z
              .object({
                clientOrigin: z.url(),
              })
              .strict(),
          }),
      })
      .strict(),
  })
  .strict();

export const CompleteSendTransactionRequestSchema = z
  .object({
    phase: z.literal("complete"),
    data: z
      .object({
        type: z.literal("transaction"),
        payload: z.object({
          startRequest: z.union([
            StartTransactionRequestSchema,
            StartMessageRequestSchema,
          ]),
          txSig: z.string(),
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
export type CompleteSendTransactionRequest = z.infer<
  typeof CompleteSendTransactionRequestSchema
>;
export type CompleteMessageRequest = z.infer<
  typeof CompleteMessageRequestSchema
>;

type AuthenticationContext = z.infer<typeof AuthenticationContextSchema>;
type BaseResponse = z.infer<typeof BaseResponseSchema>;
type TransactionDetails = z.infer<typeof TransactionDetailsSchema>;
export type TransactionAuthenticationResponse = TransactionDetails &
  AuthenticationContext &
  BaseResponse;
export type MessageAuthenticationResponse = AuthenticationContext &
  BaseResponse;
export type TransactionAuthDetails = TransactionDetails & AuthenticationContext;
