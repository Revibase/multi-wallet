import { p256 } from "@noble/curves/p256";
import {
  getSecp256r1PubkeyDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
  type TransactionPayload,
} from "@revibase/wallet-sdk";
import {
  address,
  type GetAccountInfoApi,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getU64Decoder,
  getUtf8Encoder,
  type Rpc,
} from "@solana/kit";
import { TestContext } from "../types";
import { bufferToBase64URLString, normalizeSignatureToLowS } from "./crypto";

/**
 * Creates a transaction challenge for authentication
 */
export async function createTransactionChallenge(
  connection: Rpc<GetAccountInfoApi>,
  {
    transactionActionType,
    transactionAddress,
    transactionMessageBytes,
  }: TransactionPayload
) {
  const slotSysvarData = (
    await connection
      .getAccountInfo(address("SysvarS1otHashes111111111111111111111111111"), {
        encoding: "base64",
        commitment: "processed",
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
        ...new Uint8Array(
          transactionActionType !== "close"
            ? await crypto.subtle.digest("SHA-256", transactionMessageBytes)
            : transactionMessageBytes
        ),
        ...slotHashBytes,
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
) {
  const flags = new Uint8Array([0x01]); // User present
  const signCount = new Uint8Array([0, 0, 0, 1]); // Sign counter
  const mockAuthenticatorData = new Uint8Array([
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ctx.rpId))
    ),
    ...flags,
    ...signCount,
  ]);

  const { challenge, slotHash, slotNumber } = await createTransactionChallenge(
    connection,
    transaction
  );

  const clientDataJSON = JSON.stringify({
    type: "webauthn.get",
    challenge: bufferToBase64URLString(challenge),
    origin: ctx.origin,
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

  const webauthnMessageHash = await crypto.subtle.digest(
    "SHA-256",
    messageBuffer
  );

  const signatureRS = p256
    .sign(new Uint8Array(webauthnMessageHash), privateKey)
    .toCompactRawBytes();

  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      new TextEncoder().encode("domain_config"),
      mockAuthenticatorData.subarray(0, 32),
    ],
  });

  return {
    verifyArgs: {
      publicKey: getSecp256r1PubkeyDecoder().decode(publicKey),
      clientDataJson: clientDataJSONBytes,
      slotNumber: BigInt(slotNumber),
      slotHash: new Uint8Array(getBase58Encoder().encode(slotHash)),
    },
    authData: mockAuthenticatorData,
    domainConfig,
    signature: normalizeSignatureToLowS(signatureRS),
  };
}
