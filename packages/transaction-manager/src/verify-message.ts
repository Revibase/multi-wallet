import {
  createClientAuthorizationStartRequestChallenge,
  getSecp256r1MessageHash,
  type CompleteMessageRequest,
} from "@revibase/core";
import type { WellKnownClientEntry } from "./types";
import {
  verifyClientSignature,
  verifyDeviceSignature,
  verifyUserSignature,
} from "./utils/signature-verification";

export async function verifyMessage(
  payload: CompleteMessageRequest,
  getClientDetails?: (clientOrigin: string) => Promise<WellKnownClientEntry>,
) {
  const { startRequest } = payload.data.payload;
  if (startRequest.data.type !== "message")
    throw new Error("Invalid request type.");
  if (Date.now() > startRequest.validTill) {
    throw new Error("Request expired.");
  }

  const [clientDetails] = await Promise.all([
    verifyClientSignature(
      payload.data.payload.client,
      createClientAuthorizationStartRequestChallenge(startRequest),
      getClientDetails,
    ),
    verifyDeviceSignature(
      payload.data.payload.device,
      getSecp256r1MessageHash(payload.data.payload.authResponse),
    ),
    verifyUserSignature(payload),
  ]);

  return { payload, clientDetails };
}
