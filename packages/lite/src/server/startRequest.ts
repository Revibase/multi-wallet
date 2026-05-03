import {
  convertBase64StringToJWK,
  createClientAuthorizationStartRequestChallenge,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/core";
import { getBase64Decoder } from "gill";
import { CompactSign } from "jose";
import { DEFAULT_TIMEOUT } from "src/provider/utils";

export async function startRequest(
  request:
    | Omit<StartMessageRequest, "rid" | "validTill">
    | Omit<StartTransactionRequest, "rid" | "validTill">,
  allowedClientOrigins: string[],
  privateKey: string,
) {
  if (!allowedClientOrigins.includes(request.clientOrigin)) {
    throw new Error("Invalid client origin");
  }
  const rid = getBase64Decoder().decode(
    crypto.getRandomValues(new Uint8Array(16)),
  );
  const validTill = Date.now() + DEFAULT_TIMEOUT;
  const pKey = convertBase64StringToJWK(privateKey);
  if (!pKey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    createClientAuthorizationStartRequestChallenge({
      ...request,
      rid,
      validTill,
    }),
  )
    .setProtectedHeader({
      alg: pKey.alg,
    })
    .sign(pKey);
  return { signature, validTill, rid };
}
