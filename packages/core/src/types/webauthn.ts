/**
 * WebAuthn JSON types used by passkey / secp256r1 helpers.
 * Shape matches W3C Web Authentication and SimpleWebAuthn payloads.
 */

/** Base64url-encoded binary (WebAuthn convention). */
export type Base64URLString = string;

export type AuthenticatorAssertionResponseJSON = {
  clientDataJSON: Base64URLString;
  authenticatorData: Base64URLString;
  signature: Base64URLString;
  userHandle?: Base64URLString;
};

export type AuthenticationExtensionsClientOutputsJSON = Record<
  string,
  unknown
>;

/** WebAuthn authentication assertion in JSON serialization form. */
export type AuthenticationResponseJSON = {
  id: Base64URLString;
  rawId: Base64URLString;
  response: AuthenticatorAssertionResponseJSON;
  authenticatorAttachment?: "platform" | "cross-platform";
  clientExtensionResults: AuthenticationExtensionsClientOutputsJSON;
  type: "public-key";
};
