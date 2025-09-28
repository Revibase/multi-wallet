import { sha256 } from "@noble/hashes/sha256";
import {
  type Address,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getU128Encoder,
  getU8Encoder,
  getUtf8Encoder,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";
import {
  type IPermissions,
  type MemberKey,
  MULTI_WALLET_PROGRAM_ADDRESS,
} from "../generated";
import {
  type IPermission,
  KeyType,
  PermanentMemberPermission,
  Permission,
  type PermissionArgs,
  Permissions,
  Secp256r1Key,
  TransactionManagerPermission,
} from "../types";

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

export async function getUserExtensionsAddress(member: Address) {
  const [userExtensions] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("user_extension"),
      getAddressEncoder().encode(member),
    ],
  });

  return userExtensions;
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

function normalizeKey(key: any) {
  if (key instanceof Uint8Array) return key;
  if (Array.isArray(key)) return new Uint8Array(key);
  if (typeof key === "object" && key !== null)
    return new Uint8Array(Object.values(key));
  throw new Error("Invalid key format");
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

export function createTransactionManagerSigner(
  address: Address,
  url: string,
  transactionMessageBytes?: Uint8Array,
  authorisedClients?: {
    publicKey: string;
    url: string;
  }
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

      if (authorisedClients) {
        const { url, publicKey } = authorisedClients;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload.transactions),
        });
        const data = (await response.json()) as
          | { signatures: string[] }
          | { error: string };
        if ("error" in data) {
          throw new Error(data.error);
        }
        payload.authorisedClients = {
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
export function convertPermissions(
  p: PermissionArgs,
  isPermanentMember = false,
  isTransactionManager = false
): IPermissions {
  const perms: IPermission[] = [];
  if (p.initiate) perms.push(Permission.InitiateTransaction);
  if (p.vote) perms.push(Permission.VoteTransaction);
  if (p.execute) perms.push(Permission.ExecuteTransaction);
  if (isPermanentMember) perms.push(PermanentMemberPermission);
  if (isTransactionManager) perms.push(TransactionManagerPermission);

  return Permissions.fromPermissions(perms);
}
