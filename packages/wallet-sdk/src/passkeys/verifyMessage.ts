import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getUtf8Encoder } from "@solana/kit";
import { MessageAuthenticationResponse } from "../types";
import {
  convertPubkeyCompressedToCose,
  getExpectedOrigin,
  getExpectedRPID,
} from "../utils";
import { bufferToBase64URLString } from "../utils/passkeys/internal";

export async function verifyMessage({
  message,
  response,
  expectedOrigin = getExpectedOrigin(),
  expectedRPID = getExpectedRPID(),
}: {
  message: string;
  response: MessageAuthenticationResponse;
  expectedOrigin?: string;
  expectedRPID?: string;
}): Promise<boolean> {
  const { verified } = await verifyAuthenticationResponse({
    response: response.authResponse,
    expectedChallenge: bufferToBase64URLString(
      getUtf8Encoder().encode(message)
    ),
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
    credential: {
      id: response.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(response.signer),
      counter: 0,
    },
  });

  return verified;
}
