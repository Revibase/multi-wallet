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
