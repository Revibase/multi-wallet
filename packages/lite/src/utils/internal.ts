/**
 * Builds the sign-in message text shown to the user (domain + nonce).
 *
 * @param input.domain - Optional. The requesting domain.
 * @param input.nonce - Nonce for the message.
 * @returns The formatted message string.
 */
export function createSignInMessageText(input: {
  domain?: string;
  nonce: string;
}): string {
  const message = input.domain
    ? `${input.domain} wants you to sign in with your account.`
    : "Sign in with your account.";

  const fields: string[] = [];

  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }

  return fields.length > 0 ? `${message}\n\n${fields.join("\n")}` : message;
}
