import { equalBytes } from "@noble/curves/utils.js";
import type { CompleteTransactionRequest } from "@revibase/core";
import {
  bufferToBase64URLString,
  convertBase64StringToJWK,
  convertPubkeyCompressedToCose,
  createClientAuthorizationCompleteRequestChallenge,
  createClientAuthorizationStartRequestChallenge,
  createTransactionChallenge,
  getSecp256r1MessageHash,
} from "@revibase/core";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getUtf8Encoder } from "gill";
import { CompactSign, compactVerify, importJWK } from "jose";
import { canonicalize } from "json-canonicalize";

/** Verifies WebAuthn message, returns signature. */
export async function verifyTransaction(
  request: CompleteTransactionRequest,
  expectedClientJwk: string,
  allowedClientOrigins: string[],
  privateKey: string,
) {
  const { payload } = request.data;
  if (payload.startRequest.data.type !== "transaction")
    throw new Error("Invalid request type.");
  if (
    Date.now() >
    Math.min(payload.startRequest.validTill, payload.estimatedSlotHashExpiry)
  ) {
    throw new Error("Request expired.");
  }
  if (
    !allowedClientOrigins.includes(payload.startRequest.clientOrigin) ||
    !allowedClientOrigins.includes(payload.client.clientOrigin) ||
    payload.startRequest.clientOrigin !== payload.client.clientOrigin
  ) {
    throw new Error("Invalid client origin");
  }

  {
    const key = await importJWK(convertBase64StringToJWK(expectedClientJwk));
    const result = await compactVerify(request.data.payload.client.jws, key);
    if (
      !equalBytes(
        result.payload,
        createClientAuthorizationStartRequestChallenge(
          request.data.payload.startRequest,
        ),
      )
    ) {
      throw new Error("Invalid client signature");
    }
  }

  {
    if (payload.device.jwk !== payload.device.deviceProfile.devicePublicKey) {
      throw new Error("Device publickey mismatch");
    }
    const key = await importJWK(convertBase64StringToJWK(payload.device.jwk));
    const result = await compactVerify(payload.device.jws, key);
    if (
      !equalBytes(
        result.payload,
        new Uint8Array([
          ...getSecp256r1MessageHash(request.data.payload.authResponse),
          ...getUtf8Encoder().encode(
            canonicalize(payload.device.deviceProfile),
          ),
        ]),
      )
    ) {
      throw new Error("Invalid device signature");
    }
  }
  {
    const { challenge: expectedChallenge } = await createTransactionChallenge(
      payload.startRequest.data.payload,
      payload.startRequest.clientOrigin,
      payload.device.jwk,
      payload.startRequest.rid,
      payload.slotHash,
      payload.slotNumber,
      payload.estimatedSlotHashExpiry,
    );
    const { verified } = await verifyAuthenticationResponse({
      response: payload.authResponse,
      expectedChallenge: bufferToBase64URLString(expectedChallenge),
      expectedRPID: payload.startRequest.rpId,
      expectedOrigin: payload.startRequest.providerOrigin,
      requireUserVerification: false,
      credential: {
        counter: 0,
        id: payload.authResponse.id,
        publicKey: convertPubkeyCompressedToCose(payload.signer),
      },
    });

    if (!verified) {
      throw new Error("Invalid user siganture");
    }
  }

  const pKey = convertBase64StringToJWK(privateKey);
  if (!pKey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    createClientAuthorizationCompleteRequestChallenge(request),
  )
    .setProtectedHeader({
      alg: pKey.alg,
    })
    .sign(pKey);

  return { ok: true, signature };
}
