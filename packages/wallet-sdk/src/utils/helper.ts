import { sha256 } from "@noble/hashes/sha2";
import {
  address,
  Address,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  getU128Encoder,
  getU8Encoder,
  getUtf8Encoder,
  SignatureBytes,
  TransactionSigner,
} from "@solana/kit";
import { MemberKey, MULTI_WALLET_PROGRAM_ADDRESS } from "../generated";
import { KeyType, Secp256r1Key } from "../types";
import { normalizeKey } from "./transactionMessage/internal";

export async function getDomainConfigAddress({
  rpIdHash,
  rpId,
}: {
  rpIdHash?: Uint8Array;
  rpId?: string;
}) {
  if (!rpIdHash) {
    if (rpId) {
      rpIdHash = sha256(new TextEncoder().encode(rpId));
    } else {
      throw new Error("RpId not found.");
    }
  }
  if (!rpIdHash) {
    throw new Error("RpIdHash not found.");
  }
  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("domain_config"), rpIdHash],
  });

  return domainConfig;
}

export async function getGlobalCounterAddress() {
  const [globalCounter] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("global_counter")],
  });

  return globalCounter;
}

export async function getSettingsFromIndex(index: number | bigint) {
  const [settings] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("multi_wallet"),
      getU128Encoder().encode(index),
    ],
  });

  return settings;
}

export async function getMultiWalletFromSettings(settings: Address) {
  const [multiWallet] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("multi_wallet"),
      getAddressEncoder().encode(settings),
      getUtf8Encoder().encode("vault"),
    ],
  });

  return multiWallet;
}

export async function getTransactionBufferAddress(
  settings: Address,
  creator: Address | Secp256r1Key,
  buffer_index: number
) {
  if (buffer_index > 255) {
    throw new Error("Index cannot be greater than 255.");
  }
  if (creator instanceof Secp256r1Key) {
    const [transactionBuffer] = await getProgramDerivedAddress({
      programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("multi_wallet"),
        getAddressEncoder().encode(settings),
        getUtf8Encoder().encode("transaction_buffer"),
        creator.toTruncatedBuffer(),
        getU8Encoder().encode(buffer_index),
      ],
    });

    return transactionBuffer;
  } else {
    const [transactionBuffer] = await getProgramDerivedAddress({
      programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("multi_wallet"),
        getAddressEncoder().encode(settings),
        getUtf8Encoder().encode("transaction_buffer"),
        getAddressEncoder().encode(creator),
        getU8Encoder().encode(buffer_index),
      ],
    });

    return transactionBuffer;
  }
}

export function convertMemberKeyToString(memberKey: MemberKey) {
  if (memberKey.keyType === KeyType.Ed25519) {
    return getBase58Decoder().decode(
      normalizeKey(memberKey.key).subarray(1, 33)
    );
  } else {
    return getBase58Decoder().decode(normalizeKey(memberKey.key));
  }
}

export async function getRandomPayer(
  payerEndpoint: string
): Promise<TransactionSigner> {
  const response = await fetch(`${payerEndpoint}/getRandomPayer`);
  const { randomPayer } = (await response.json()) as { randomPayer: string };
  return {
    address: address(randomPayer),
    signTransactions(transactions) {
      return new Promise(async (resolve, reject) => {
        try {
          const signatureResponse = await fetch(`${payerEndpoint}/sign`, {
            method: "POST",
            body: JSON.stringify({
              publicKey: randomPayer,
              transactions: transactions.map((x) =>
                getBase64Decoder().decode(getTransactionEncoder().encode(x))
              ),
            }),
          });
          if (!signatureResponse.ok) {
            throw new Error(await signatureResponse.json());
          }
          const { signatures } = (await signatureResponse.json()) as {
            signatures: string[];
          };
          resolve(
            signatures.map((x) => ({
              [address(randomPayer)]: getBase58Encoder().encode(
                x
              ) as SignatureBytes,
            }))
          );
        } catch (error) {
          reject(error);
        }
      });
    },
  };
}
