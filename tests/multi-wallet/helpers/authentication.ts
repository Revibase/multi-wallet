import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  createTransactionChallenge,
  getDomainConfigAddress,
  getOriginIndex,
  getSignedSecp256r1Key,
  Secp256r1Key,
  SignedSecp256r1Key,
  type TransactionPayload,
} from "@revibase/core";
import { getBase58Decoder, getBase64Decoder } from "gill";
import type { TestContext } from "../types.ts";
import { bufferToBase64URLString } from "./crypto.ts";

/**
 * Creates a mock authentication response for testing
 */
export async function mockAuthenticationResponse(
  transaction: TransactionPayload,
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  ctx: TestContext
): Promise<SignedSecp256r1Key> {
  const nonce = crypto.randomUUID();
  const clientOrigin = "https://app.revibase.com";
  const devicePublicKey = getBase58Decoder().decode(
    crypto.getRandomValues(new Uint8Array(32))
  );
  const flags = new Uint8Array([0x01]); // User present
  const signCount = new Uint8Array([0, 0, 0, 1]); // Sign counter
  const mockAuthenticatorData = new Uint8Array([
    ...sha256(new TextEncoder().encode(ctx.rpId)),
    ...flags,
    ...signCount,
  ]);

  let challenge: Uint8Array;
  let slotHash: string | undefined;
  let slotNumber: string | undefined;

  ({ challenge, slotHash, slotNumber } = await createTransactionChallenge(
    transaction,
    clientOrigin,
    devicePublicKey,
    nonce
  ));

  const origin = "happy";
  const crossOrigin = false;

  const clientDataJSON = JSON.stringify({
    type: "webauthn.get",
    challenge: bufferToBase64URLString(challenge.buffer as ArrayBuffer),
    origin,
    crossOrigin,
  });

  const clientDataJSONBytes = new TextEncoder().encode(clientDataJSON);

  // Hash clientDataJSON
  const clientDataHash = sha256(clientDataJSONBytes);

  const messageBuffer = new Uint8Array([
    ...mockAuthenticatorData,
    ...new Uint8Array(clientDataHash),
  ]);

  const signature = new Uint8Array(
    p256.sign(messageBuffer, privateKey, {
      format: "compact",
      lowS: true,
    })
  );

  const originIndex = await getOriginIndex(
    await getDomainConfigAddress({ rpId: ctx.rpId }),
    origin
  );

  return await getSignedSecp256r1Key({
    slotNumber,
    slotHash,
    signer: new Secp256r1Key(publicKey).toString(),
    authResponse: {
      id: "",
      rawId: "",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: bufferToBase64URLString(
          mockAuthenticatorData.buffer
        ),
        clientDataJSON: bufferToBase64URLString(clientDataJSONBytes.buffer),
        signature: bufferToBase64URLString(signature.buffer),
      },
    },
    transactionPayload: {
      ...transaction,
      transactionMessageBytes: getBase64Decoder().decode(
        transaction.transactionMessageBytes
      ),
    },
    clientSignature: {
      clientOrigin,
      signature: getBase58Decoder().decode(
        crypto.getRandomValues(new Uint8Array(64))
      ),
    },
    deviceSignature: {
      publicKey: devicePublicKey,
      signature: getBase58Decoder().decode(
        crypto.getRandomValues(new Uint8Array(64))
      ),
    },
    nonce,
    originIndex,
    crossOrigin,
  });
}
