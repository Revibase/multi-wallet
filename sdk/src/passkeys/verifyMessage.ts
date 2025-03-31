import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes/index.js";
import { CBORType, encodeCBOR } from "@levischuck/tiny-cbor";
import { p256 } from "@noble/curves/p256";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { IDP_URL, RP_ID } from "./consts.js";
import { AuthenticationResponse } from "./types.js";

export async function verifyMessage(
  message: string,
  response: AuthenticationResponse
): Promise<boolean> {
  const compressedPublicKey = p256.ProjectivePoint.fromHex(
    bs58.decode(response.secp256r1PublicKey)
  );
  const uncompressedPublicKey = compressedPublicKey.toRawBytes(false);

  const coseDecodedPublicKey = new Map<string | number, CBORType>();
  coseDecodedPublicKey.set(1, 2);
  coseDecodedPublicKey.set(3, -7);
  coseDecodedPublicKey.set(-1, 1);
  coseDecodedPublicKey.set(-2, uncompressedPublicKey.slice(1, 33));
  coseDecodedPublicKey.set(-3, uncompressedPublicKey.slice(33, 65));

  const cborData = encodeCBOR(coseDecodedPublicKey);

  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: Buffer.from(message, "utf-8").toString("base64url"),
    expectedOrigin: IDP_URL,
    expectedRPID: RP_ID,
    requireUserVerification: false,
    credential: {
      id: response.id,
      publicKey: cborData,
      counter: 0,
    },
  });

  return result.verified;
}
