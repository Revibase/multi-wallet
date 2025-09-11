import { SignaturesMap } from "@solana/kit";
import { SolanaSignInInput } from "@solana/wallet-standard-features";

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return arraysEqual(a, b);
}

interface Indexed<T> {
  length: number;
  [index: number]: T;
}

export function arraysEqual<T>(a: Indexed<T>, b: Indexed<T>): boolean {
  if (a === b) return true;

  const length = a.length;
  if (length !== b.length) return false;

  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

export function assertTransactionIsNotSigned(signatures: SignaturesMap) {
  const missingSigs = [];
  Object.entries(signatures).forEach(([address, signatureBytes]) => {
    if (!signatureBytes) {
      missingSigs.push(address);
    }
  });
  if (missingSigs.length !== Object.entries(signatures).length) {
    throw new Error("Transaction cannot be partially signed.");
  }
}

export function createSignInMessageText(input: SolanaSignInInput): string {
  // ${domain} wants you to sign in with your Solana account:
  // ${address}
  //
  // ${statement}
  //
  // URI: ${uri}
  // Version: ${version}
  // Chain ID: ${chain}
  // Nonce: ${nonce}
  // Issued At: ${issued-at}
  // Expiration Time: ${expiration-time}
  // Not Before: ${not-before}
  // Request ID: ${request-id}
  // Resources:
  // - ${resources[0]}
  // - ${resources[1]}
  // ...
  // - ${resources[n]}

  let message = `${input.domain} wants you to sign in with your Solana account`;
  message += input.address ? `:\n${input.address}` : `.`;

  if (input.statement) {
    message += `\n\n${input.statement}`;
  }

  const fields: string[] = [];
  if (input.uri) {
    fields.push(`URI: ${input.uri}`);
  }
  if (input.version) {
    fields.push(`Version: ${input.version}`);
  }
  if (input.chainId) {
    fields.push(`Chain ID: ${input.chainId}`);
  }
  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }
  if (input.issuedAt) {
    fields.push(`Issued At: ${input.issuedAt}`);
  }
  if (input.expirationTime) {
    fields.push(`Expiration Time: ${input.expirationTime}`);
  }
  if (input.notBefore) {
    fields.push(`Not Before: ${input.notBefore}`);
  }
  if (input.requestId) {
    fields.push(`Request ID: ${input.requestId}`);
  }
  if (input.resources) {
    fields.push(`Resources:`);
    for (const resource of input.resources) {
      fields.push(`- ${resource}`);
    }
  }
  if (fields.length) {
    message += `\n\n${fields.join("\n")}`;
  }

  return message;
}
