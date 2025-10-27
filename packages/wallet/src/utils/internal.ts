import { sha256 } from "@noble/hashes/sha256";
import {
  type Address,
  address,
  getBase58Encoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getTransactionEncoder,
  type Instruction,
  type OptionOrNullable,
  type ReadonlyUint8Array,
  type SignatureBytes,
  some,
  type TransactionSigner,
} from "gill";
import { getTransferSolInstruction } from "gill/programs";
import type { Secp256r1VerifyArgs } from "../generated";
import { SignedSecp256r1Key } from "../types";
import { JITO_TIP_ACCOUNTS } from "./consts";

export function extractSecp256r1VerificationArgs(
  signer?: SignedSecp256r1Key | TransactionSigner,
  index = 0
) {
  const secp256r1PublicKey =
    signer instanceof SignedSecp256r1Key ? signer : undefined;
  const verifyArgs: OptionOrNullable<Secp256r1VerifyArgs> =
    secp256r1PublicKey?.verifyArgs && index !== -1
      ? some({
          signedMessageIndex: index,
          truncatedClientDataJson:
            secp256r1PublicKey.verifyArgs.truncatedClientDataJson,
          slotNumber: secp256r1PublicKey.verifyArgs.slotNumber,
          originIndex: secp256r1PublicKey.originIndex,
          crossOrigin: secp256r1PublicKey.crossOrigin,
        })
      : null;
  const instructionsSysvar =
    signer instanceof SignedSecp256r1Key
      ? address("Sysvar1nstructions1111111111111111111111111")
      : undefined;
  const slotHashSysvar = secp256r1PublicKey?.verifyArgs
    ? address("SysvarS1otHashes111111111111111111111111111")
    : undefined;
  const domainConfig = secp256r1PublicKey?.domainConfig
    ? secp256r1PublicKey.domainConfig
    : undefined;
  const signature = secp256r1PublicKey?.verifyArgs
    ? secp256r1PublicKey.signature
    : undefined;
  const message =
    secp256r1PublicKey?.authData &&
    secp256r1PublicKey.verifyArgs?.clientDataJson
      ? new Uint8Array([
          ...secp256r1PublicKey.authData,
          ...sha256(secp256r1PublicKey.verifyArgs.clientDataJson),
        ])
      : undefined;
  const publicKey = secp256r1PublicKey?.toBuffer();

  return {
    slotHashSysvar,
    instructionsSysvar,
    domainConfig,
    verifyArgs,
    signature,
    message,
    publicKey,
  };
}
export function getDeduplicatedSigners(
  signers: (SignedSecp256r1Key | TransactionSigner)[]
) {
  const hashSet = new Set();
  const dedupSigners: (SignedSecp256r1Key | TransactionSigner)[] = [];
  for (const signer of signers) {
    if (!hashSet.has(getPubkeyString(signer))) {
      dedupSigners.push(signer);
      hashSet.add(getPubkeyString(signer));
    }
  }

  // due to current tx size limit (can be removed once tx size limit increases)
  if (dedupSigners.filter((x) => x instanceof SignedSecp256r1Key).length > 1) {
    throw new Error(
      "More than 1 Secp256r1 signers in an instruction is not supported."
    );
  }
  return dedupSigners;
}
function getPubkeyString(pubkey: TransactionSigner | SignedSecp256r1Key) {
  if (pubkey instanceof SignedSecp256r1Key) {
    return pubkey.toString();
  } else {
    return pubkey.address.toString();
  }
}

export function addJitoTip({
  payer,
  tipAmount,
}: {
  payer: TransactionSigner;
  tipAmount: number;
}): Instruction {
  const tipAccount =
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return getTransferSolInstruction({
    source: payer,
    destination: address(tipAccount),
    amount: tipAmount,
  });
}
export async function getRandomPayer(
  payerEndpoint: string
): Promise<TransactionSigner> {
  const response = await fetch(`${payerEndpoint}/getRandomPayer`);
  const { randomPayer } = (await response.json()) as { randomPayer: string };

  return {
    address: address(randomPayer),
    async signTransactions(transactions) {
      const payload = {
        publicKey: randomPayer,
        transactions: transactions.map((tx) =>
          getBase64Decoder().decode(getTransactionEncoder().encode(tx))
        ),
      };

      const response = await fetch(`${payerEndpoint}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | { signatures: string[] }
        | { error: string };

      if ("error" in data) {
        throw new Error(data.error);
      }

      return data.signatures.map((sig) => ({
        [address(randomPayer)]: getBase58Encoder().encode(
          sig
        ) as SignatureBytes,
      }));
    },
  };
}
export function createTransactionManagerSigner(
  address: Address,
  url: string,
  transactionMessageBytes?: ReadonlyUint8Array,
  authorizedClient?: {
    publicKey: string;
    url: string;
  } | null
): TransactionSigner {
  return {
    address,
    async signTransactions(transactions) {
      const payload: Record<
        string,
        string | string[] | { publicKey: string; signatures: string[] }
      > = {
        publicKey: address.toString(),
        transactions: transactions.map(getBase64EncodedWireTransaction),
      };

      if (transactionMessageBytes) {
        payload.transactionMessageBytes = getBase64Decoder().decode(
          transactionMessageBytes
        );
      }

      if (authorizedClient) {
        const { url, publicKey } = authorizedClient;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactions: payload.transactions,
            publicKey,
          }),
        });
        const data = (await response.json()) as
          | { signatures: string[] }
          | { error: string };
        if ("error" in data) {
          throw new Error(data.error);
        }
        payload.authorizedClient = {
          publicKey,
          signatures: data.signatures,
        };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | { signatures: string[] }
        | { error: string };

      if ("error" in data) {
        throw new Error(data.error);
      }

      return data.signatures.map((sig) => ({
        [address]: getBase58Encoder().encode(sig) as SignatureBytes,
      }));
    },
  };
}
