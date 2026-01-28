import { decodeCBOR, encodeCBOR, type CBORType } from "@levischuck/tiny-cbor";
import { p256 } from "@noble/curves/nist.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import {
  address,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  getU64Decoder,
  getUtf8Encoder,
  type Address,
  type ReadonlyUint8Array,
} from "gill";
import {
  SignedSecp256r1Key,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type StartMessageRequest,
  type StartTransactionRequest,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
  type TransactionPayloadWithBase64MessageBytes,
} from "../../types";
import { getDomainConfigAddress } from "../addresses";
import { sha256 } from "../crypto";
import { getSolanaRpc } from "../initialize";
import {
  convertSignatureDERtoRS,
  extractAdditionalFields,
  getSecp256r1Message,
  parseOrigins,
  uint8ArrayToHex,
} from "./internal";

export function convertPubkeyCoseToCompressed(
  publicKey: Uint8Array<ArrayBuffer>,
) {
  const decodedPublicKey = decodeCBOR(publicKey) as Map<number, CBORType>;
  const uncompressedPublicKey = p256.Point.fromAffine({
    x: BigInt(
      "0x" +
        uint8ArrayToHex(decodedPublicKey.get(-2) as Uint8Array<ArrayBuffer>),
    ),
    y: BigInt(
      "0x" +
        uint8ArrayToHex(decodedPublicKey.get(-3) as Uint8Array<ArrayBuffer>),
    ),
  });
  const compressedPubKey = getBase58Decoder().decode(
    uncompressedPublicKey.toBytes(true),
  );
  return compressedPubKey;
}

export function convertPubkeyCompressedToCose(
  publicKey: string,
): Uint8Array<ArrayBuffer> {
  const compressedPublicKey = p256.Point.fromBytes(
    getBase58Encoder().encode(publicKey) as Uint8Array,
  );
  const uncompressedPublicKey = compressedPublicKey.toBytes(false);

  const coseDecodedPublicKey = new Map<string | number, CBORType>();
  coseDecodedPublicKey.set(1, 2);
  coseDecodedPublicKey.set(3, -7);
  coseDecodedPublicKey.set(-1, 1);
  coseDecodedPublicKey.set(-2, uncompressedPublicKey.slice(1, 33));
  coseDecodedPublicKey.set(-3, uncompressedPublicKey.slice(33, 65));

  return new Uint8Array(encodeCBOR(coseDecodedPublicKey));
}

export async function getSignedSecp256r1Key(
  payload: TransactionAuthenticationResponse,
): Promise<SignedSecp256r1Key> {
  const { authenticatorData, clientDataJSON, signature } = (
    payload.authResponse as AuthenticationResponseJSON
  ).response;

  const authData = base64URLStringToBuffer(authenticatorData);

  const clientDataJsonParsed = JSON.parse(
    new TextDecoder().decode(base64URLStringToBuffer(clientDataJSON)),
  ) as Record<string, unknown>;

  const truncatedClientDataJson = extractAdditionalFields(clientDataJsonParsed);

  const convertedSignature = convertSignatureDERtoRS(
    base64URLStringToBuffer(signature),
  );

  const domainConfig = await getDomainConfigAddress({
    rpIdHash: authData.subarray(0, 32),
  });

  return new SignedSecp256r1Key(payload.signer.toString(), {
    verifyArgs: {
      clientDataJson: base64URLStringToBuffer(clientDataJSON),
      truncatedClientDataJson,
      slotNumber: BigInt(payload.slotNumber),
      slotHash: getBase58Encoder().encode(
        payload.slotHash,
      ) as Uint8Array<ArrayBuffer>,
    },
    clientAndDeviceHash: await getClientAndDeviceHash(
      payload.clientSignature.clientOrigin,
      payload.deviceSignature.publicKey,
      payload.nonce,
    ),
    domainConfig,
    authData,
    signature: convertedSignature,
    originIndex: payload.originIndex,
    crossOrigin: payload.crossOrigin,
    authResponse: payload.authResponse,
  });
}

import { NotFoundError } from "../../errors";
import { fetchDomainConfig } from "../../generated";

export async function getClientAndDeviceHash(
  clientOrigin: string,
  devicePublicKey: string,
  nonce: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(
    new Uint8Array([
      ...getUtf8Encoder().encode(clientOrigin),
      ...getBase58Encoder().encode(devicePublicKey),
      ...getUtf8Encoder().encode(nonce),
    ]),
  );
}

export async function createClientAuthorizationStartRequestChallenge(
  payload: StartTransactionRequest | StartMessageRequest,
): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(
    getUtf8Encoder().encode(JSON.stringify(payload)) as Uint8Array<ArrayBuffer>,
  );
}

export async function createClientAuthorizationCompleteRequestChallenge(
  payload: CompleteTransactionRequest | CompleteMessageRequest,
): Promise<Uint8Array<ArrayBuffer>> {
  return getSecp256r1MessageHash(payload.data.payload.authResponse);
}

export async function createMessageChallenge(
  payload: string,
  clientOrigin: string,
  devicePublicKey: string,
  nonce: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const clientDeviceHash = await getClientAndDeviceHash(
    clientOrigin,
    devicePublicKey,
    nonce,
  );
  return sha256(
    new Uint8Array([...getUtf8Encoder().encode(payload), ...clientDeviceHash]),
  );
}

export async function createTransactionChallenge(
  payload: TransactionPayloadWithBase64MessageBytes | TransactionPayload,
  clientOrigin: string,
  devicePublicKey: string,
  nonce: string,
  slotHash?: string,
  slotNumber?: string,
) {
  let slotHashBytes: ReadonlyUint8Array;
  if (!slotHash || !slotNumber) {
    const slotSysvarData = (
      await getSolanaRpc()
        .getAccountInfo(
          address("SysvarS1otHashes111111111111111111111111111"),
          {
            encoding: "base64",
            commitment: "confirmed",
            dataSlice: { offset: 8, length: 40 },
          },
        )
        .send()
    ).value?.data;
    if (!slotSysvarData) {
      throw new NotFoundError(
        "Slot sysvar",
        "Unable to fetch slot sysvar data",
      );
    }
    const slotHashData = getBase64Encoder().encode(slotSysvarData[0]);
    slotNumber = getU64Decoder().decode(slotHashData.subarray(0, 8)).toString();
    slotHashBytes = slotHashData.subarray(8, 40);
    slotHash = getBase58Decoder().decode(slotHashBytes);
  } else {
    slotHashBytes = getBase58Encoder().encode(slotHash);
  }

  const transactionMessageHash = await sha256(
    typeof payload.transactionMessageBytes === "string"
      ? base64URLStringToBuffer(payload.transactionMessageBytes)
      : payload.transactionMessageBytes,
  );
  const clientDeviceHash = await getClientAndDeviceHash(
    clientOrigin,
    devicePublicKey,
    nonce,
  );
  const challenge = await sha256(
    new Uint8Array([
      ...getUtf8Encoder().encode(payload.transactionActionType),
      ...getBase58Encoder().encode(payload.transactionAddress),
      ...transactionMessageHash,
      ...slotHashBytes,
      ...clientDeviceHash,
    ]),
  );
  return { slotNumber, slotHash, challenge };
}

export async function getSecp256r1MessageHash(
  authResponse: AuthenticationResponseJSON,
): Promise<Uint8Array<ArrayBuffer>> {
  const message = await getSecp256r1Message(authResponse);
  return sha256(message);
}

export function bufferToBase64URLString(buffer: Uint8Array<ArrayBuffer>) {
  let str = "";
  for (const charCode of buffer) {
    str += String.fromCharCode(charCode);
  }
  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64URLStringToBuffer(base64URLString: string) {
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function getOriginIndex(domainConfig: Address, origin: string) {
  const { data } = await fetchDomainConfig(getSolanaRpc(), domainConfig);
  const origins = parseOrigins(data.origins, data.numOrigins);
  const index = origins.findIndex((x) => x === origin);
  if (index === -1) {
    throw new Error("Origin not found in domain config");
  }
  return index;
}
