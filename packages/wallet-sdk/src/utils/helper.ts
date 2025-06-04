import {
  Address,
  address,
  getAddressEncoder,
  getBase58Decoder,
  getProgramDerivedAddress,
  getU16Decoder,
  getU16Encoder,
  getU8Encoder,
  getUtf8Encoder,
  isAddress,
} from "@solana/kit";
import {
  ConfigAction,
  getConfigActionDecoder,
  getConfigActionEncoder,
  MemberKey,
  MULTI_WALLET_PROGRAM_ADDRESS,
} from "../generated";
import { ConfigActionWrapper, KeyType, Secp256r1Key } from "../types";
import { convertConfigActionWrapper, getHash, normalizeKey } from "./internal";

export async function getDomainConfig({
  rpIdHash,
  rpId,
}: {
  rpIdHash?: Uint8Array;
  rpId?: string;
}) {
  if (!rpIdHash) {
    if (rpId) {
      rpIdHash = await getHash(rpId);
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

export async function getDelegateAddress(
  walletAddress: Address | Secp256r1Key
) {
  if (walletAddress instanceof Secp256r1Key) {
    const [delegatePda] = await getProgramDerivedAddress({
      programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("delegate"),
        walletAddress.toTruncatedBuffer(),
      ],
    });
    return delegatePda;
  } else if (isAddress(walletAddress.toString())) {
    const [delegatePda] = await getProgramDerivedAddress({
      programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("delegate"),
        getAddressEncoder().encode(address(walletAddress.toString())),
      ],
    });

    return delegatePda;
  } else {
    throw new Error("Unable to parse Public Key");
  }
}

export async function getSettingsFromCreateKey(createKey: Uint8Array) {
  const [settings] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("multi_wallet"), createKey],
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
  } else if (isAddress(creator.toString())) {
    const [transactionBuffer] = await getProgramDerivedAddress({
      programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("multi_wallet"),
        getAddressEncoder().encode(settings),
        getUtf8Encoder().encode("transaction_buffer"),
        getAddressEncoder().encode(address(creator.toString())),
        getU8Encoder().encode(buffer_index),
      ],
    });

    return transactionBuffer;
  } else {
    throw new Error("Unable to parse PublicKey.");
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

export function serializeConfigActions(configActions: ConfigActionWrapper[]) {
  const converted = convertConfigActionWrapper(configActions);
  const serializedActions = converted.map((x) =>
    getConfigActionEncoder().encode(x)
  );
  const totalLength = serializedActions.reduce(
    (acc, bytes) => acc + 2 + bytes.length,
    0
  );
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const serialized of serializedActions) {
    if (serialized.length > 0xffff) {
      throw new Error("Serialized config_action too large for u16 prefix");
    }

    result.set(getU16Encoder().encode(serialized.length), offset);
    offset += 2;

    result.set(serialized, offset);
    offset += serialized.length;
  }

  return result;
}

export function deserializeConfigActions(
  configActions: Uint8Array
): ConfigAction[] {
  const result: ConfigAction[] = [];

  let offset = 0;
  while (offset < configActions.length) {
    if (offset + 2 > configActions.length) {
      throw new Error("Unexpected end of buffer while reading length prefix.");
    }

    // Read u16 length (little endian)
    const length = getU16Decoder().decode(
      configActions.subarray(offset, offset + 2)
    );
    offset += 2;

    if (offset + length > configActions.length) {
      throw new Error("Unexpected end of buffer while reading config action.");
    }

    const bytes = configActions.subarray(offset, offset + length);
    const decoded = getConfigActionDecoder().decode(bytes);
    result.push(decoded);
    offset += length;
  }

  return result;
}
