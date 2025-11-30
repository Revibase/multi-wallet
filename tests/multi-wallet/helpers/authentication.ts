import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import {
  getDomainConfigAddress,
  getOriginIndex,
  getSignedSecp256r1Key,
  Secp256r1Key,
  SignedSecp256r1Key,
  type TransactionPayload,
} from "@revibase/core";
import {
  address,
  type GetAccountInfoApi,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getU64Decoder,
  getUtf8Encoder,
  type Rpc,
} from "gill";
import type { TestContext } from "../types.ts";
import { bufferToBase64URLString } from "./crypto.ts";

/**
 * Creates a transaction challenge for authentication
 */
export async function createTransactionChallenge(
  connection: Rpc<GetAccountInfoApi>,
  {
    transactionActionType,
    transactionAddress,
    transactionMessageBytes,
  }: TransactionPayload,
  requestedClient: string,
  device: Uint8Array
) {
  const slotSysvarData = (
    await connection
      .getAccountInfo(address("SysvarS1otHashes111111111111111111111111111"), {
        encoding: "base64",
      })
      .send()
  ).value?.data;

  if (!slotSysvarData) {
    throw new Error("Unable to fetch slot sysvar");
  }

  const slotHashData = getBase64Encoder().encode(slotSysvarData[0]);
  const slotNumber = getU64Decoder()
    .decode(slotHashData.subarray(8, 16))
    .toString();
  const slotHashBytes = slotHashData.subarray(16, 48);
  const slotHash = getBase58Decoder().decode(slotHashBytes);

  const challenge = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array([
        ...new Uint8Array(getUtf8Encoder().encode(transactionActionType)),
        ...getBase58Encoder().encode(transactionAddress),
        ...sha256(transactionMessageBytes),
        ...slotHashBytes,
        ...sha256(
          new Uint8Array([
            ...new TextEncoder().encode(requestedClient),
            ...device,
          ])
        ),
      ])
    )
  );

  return { slotNumber, slotHash, challenge };
}

/**
 * Creates a mock authentication response for testing
 */
export async function mockAuthenticationResponse(
  connection: Rpc<GetAccountInfoApi>,
  transaction: TransactionPayload,
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  ctx: TestContext
): Promise<SignedSecp256r1Key> {
  const requestedClient = "https://app.revibase.com";
  const device = crypto.getRandomValues(new Uint8Array(32));
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
    connection,
    transaction,
    requestedClient,
    device
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
  const clientDataHash = await crypto.subtle.digest(
    "SHA-256",
    clientDataJSONBytes
  );

  const messageBuffer = new Uint8Array([
    ...mockAuthenticatorData,
    ...new Uint8Array(clientDataHash),
  ]);

  const webauthnMessageHash = sha256(messageBuffer);

  const signature = new Uint8Array(
    p256
      .sign(new Uint8Array(webauthnMessageHash), privateKey, {
        format: "compact",
        lowS: true,
      })
      .toBytes("compact")
  );

  const originIndex = await getOriginIndex(
    await getDomainConfigAddress({ rpId: ctx.rpId }),
    origin
  );

  return await getSignedSecp256r1Key(
    {
      slotNumber,
      slotHash,
      signer: new Secp256r1Key(publicKey),
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
      requestedClient,
      deviceSignature: {
        publicKey: getBase58Decoder().decode(device),
        signature: getBase58Decoder().decode(
          crypto.getRandomValues(new Uint8Array(64))
        ),
      },
    },
    originIndex,
    crossOrigin
  );
}
