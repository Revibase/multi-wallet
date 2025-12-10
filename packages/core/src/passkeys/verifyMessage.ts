import { ed25519 } from "@noble/curves/ed25519.js";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getBase58Encoder } from "gill";
import type { MessageAuthenticationResponse } from "../types";
import {
  convertPubkeyCompressedToCose,
  getAuthEndpoint,
  getClientAndDeviceHash,
  getRpId,
  getSecp256r1MessageHash,
} from "../utils";
import { bufferToBase64URLString } from "../utils/passkeys/internal";

export async function verifyMessage({
  message,
  response,
  expectedRPID = getRpId(),
  expectedOrigin = getAuthEndpoint(),
}: {
  message: string;
  response: MessageAuthenticationResponse;
  expectedRPID?: string;
  expectedOrigin?: string;
}): Promise<boolean> {
  const challenge = new Uint8Array([
    ...new TextEncoder().encode(message),
    ...getClientAndDeviceHash(
      response.clientId,
      response.deviceSignature.publicKey,
      response.nonce
    ),
  ]);

  const { verified } = await verifyAuthenticationResponse({
    response: response.authResponse,
    expectedChallenge: bufferToBase64URLString(challenge),
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
    credential: {
      id: response.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(response.signer.toString()),
      counter: 0,
    },
  });

  const deviceVerified = ed25519.verify(
    new Uint8Array(
      getBase58Encoder().encode(response.deviceSignature.signature)
    ),
    getSecp256r1MessageHash(response.authResponse),
    new Uint8Array(
      getBase58Encoder().encode(response.deviceSignature.publicKey)
    )
  );

  return verified && deviceVerified;
}
