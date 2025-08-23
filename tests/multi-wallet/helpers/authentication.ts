import { p256 } from "@noble/curves/nist.js";
import {
  ParsedAuthenticationResponse,
  type TransactionPayload,
} from "@revibase/wallet-sdk";
import {
  address,
  type GetAccountInfoApi,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
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
          await crypto.subtle.digest("SHA-256", transactionMessageBytes)
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
  ctx: TestContext
): Promise<ParsedAuthenticationResponse> {
  const flags = new Uint8Array([0x01]); // User present
  const signCount = new Uint8Array([0, 0, 0, 1]); // Sign counter
  const mockAuthenticatorData = new Uint8Array([
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ctx.rpId))
    ),
    ...flags,
    ...signCount,
  ]);

  let challenge: Uint8Array;
  let slotHash: string | undefined;
  let slotNumber: string | undefined;
  if (transaction.transactionActionType === "create_new_wallet") {
    challenge = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array([
          ...getUtf8Encoder().encode("create_new_wallet"),
          ...getAddressEncoder().encode(ctx.domainConfig),
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new Uint8Array(getUtf8Encoder().encode(ctx.rpId))
            )
          ),
        ])
      )
    );
  } else {
    ({ challenge, slotHash, slotNumber } = await createTransactionChallenge(
      connection,
      transaction
    ));
  }

  const clientDataJSON = JSON.stringify({
    type: "webauthn.get",
    challenge: bufferToBase64URLString(challenge.buffer as ArrayBuffer),
    origin: "happy",
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
    .toBytes("compact");

  return {
    verifyArgs: {
      clientDataJson: clientDataJSONBytes,
      slotNumber: BigInt(slotNumber ?? 0),
      slotHash: slotHash
        ? new Uint8Array(getBase58Encoder().encode(slotHash))
        : undefined,
    },
    credentialId: getBase58Decoder().decode(
      crypto.getRandomValues(new Uint8Array(32))
    ),
    authData: mockAuthenticatorData,
    domainConfig: ctx.domainConfig,
    signature: normalizeSignatureToLowS(signatureRS),
  };
}
