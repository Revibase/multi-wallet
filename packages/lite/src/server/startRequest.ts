import {
  convertBase64StringToJWK,
  createClientAuthorizationStartRequestChallenge,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/core";
import { CompactSign } from "jose";
import { DEFAULT_TIMEOUT } from "src/provider/utils";

export async function startRequest(
  request:
    | Omit<StartMessageRequest, "validTill">
    | Omit<StartTransactionRequest, "validTill">,
  allowedClientOrigins: string[],
  privateKey: string,
) {
  if (!allowedClientOrigins.includes(request.clientOrigin)) {
    throw new Error("Invalid client origin");
  }
  const validTill = Date.now() + DEFAULT_TIMEOUT;
  const pKey = convertBase64StringToJWK(privateKey);
  if (!pKey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    createClientAuthorizationStartRequestChallenge({
      ...request,
      validTill,
    }),
  )
    .setProtectedHeader({
      alg: pKey.alg,
    })
    .sign(pKey);
  return { signature, validTill };
}
