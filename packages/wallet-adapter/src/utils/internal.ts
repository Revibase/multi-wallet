import {
  bufferToBase64URLString,
  getJitoTipsConfig,
  SignedSecp256r1Key,
} from "@revibase/core";
import { getAddressDecoder } from "gill";

/**
 * Creates a standardized sign-in message text for authentication.
 *
 * The message follows a standard format that includes the domain and nonce
 * for security purposes.
 *
 * @param input - Message parameters
 * @param input.domain - Optional domain name (e.g., "example.com")
 * @param input.nonce - Unique nonce for this authentication attempt
 * @returns Formatted sign-in message string
 */
export function createSignInMessageText(input: {
  domain?: string;
  nonce: string;
}): string {
  let message = "";

  if (input.domain) {
    message += `${input.domain} wants you to sign in with your account.`;
  } else {
    message += `Sign in with your account.`;
  }

  const fields: string[] = [];

  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }
  if (fields.length) {
    message += `\n\n${fields.join("\n")}`;
  }

  return message;
}

/**
 * Creates a simulated Secp256r1 signer for transaction size estimation.
 *
 * This function generates random data to simulate a real signer without
 * requiring actual cryptographic operations. Used for estimating transaction
 * sizes before building the actual transaction.
 *
 * @returns A simulated SignedSecp256r1Key instance
 */
export function simulateSecp256r1Signer() {
  const randomPubkey = crypto.getRandomValues(new Uint8Array(33));
  const authData = crypto.getRandomValues(new Uint8Array(37));
  const clientDataJSON = crypto.getRandomValues(new Uint8Array(250));
  const signature = crypto.getRandomValues(new Uint8Array(64));
  const signer = new SignedSecp256r1Key(randomPubkey, {
    originIndex: 0,
    crossOrigin: false,
    authData,
    domainConfig: getAddressDecoder().decode(
      crypto.getRandomValues(new Uint8Array(32)),
    ),
    signature,
    verifyArgs: {
      slotHash: crypto.getRandomValues(new Uint8Array(32)),
      slotNumber: BigInt(0),
      truncatedClientDataJson: crypto.getRandomValues(new Uint8Array(100)),
      clientDataJson: clientDataJSON,
    },
    clientAndDeviceHash: crypto.getRandomValues(new Uint8Array(32)),
    authResponse: {
      id: "",
      rawId: "",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: bufferToBase64URLString(authData),
        clientDataJSON: bufferToBase64URLString(clientDataJSON),
        signature: bufferToBase64URLString(signature),
      },
    },
  });
  return signer;
}

/**
 * Estimates Jito tip amount for transaction bundles.
 *
 * Fetches current Jito tip recommendations from the configured endpoint
 * and converts the value to lamports.
 *
 * @param jitoTipsConfig - Optional Jito tips configuration (defaults to global config)
 * @returns Estimated tip amount in lamports
 * @throws {Error} If the fetch or parsing fails
 */
export async function estimateJitoTips(
  jitoTipsConfig = getJitoTipsConfig(),
): Promise<number> {
  const { getJitoTipsUrl: estimateJitoTipsEndpoint, priority } = jitoTipsConfig;

  let response: Response;
  try {
    response = await fetch(estimateJitoTipsEndpoint);
    if (!response.ok) {
      throw new Error(`Failed to fetch Jito tips: ${response.statusText}`);
    }
  } catch (error) {
    throw new Error(
      `Network error while fetching Jito tips: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(
      `Failed to parse Jito tips response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !Array.isArray(result) ||
    result.length === 0 ||
    !result[0] ||
    typeof result[0] !== "object" ||
    !(priority in result[0]) ||
    typeof result[0][priority] !== "number"
  ) {
    throw new Error("Invalid Jito tips response format");
  }

  const tipAmount = Math.round(result[0][priority] * 10 ** 9);
  return tipAmount;
}
