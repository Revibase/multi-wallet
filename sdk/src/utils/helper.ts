import {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  LAMPORTS_PER_SOL,
  MessageV0,
  PublicKey,
  TransactionMessage as SolanaTransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { Buffer } from "buffer";
import invariant from "invariant";
import {
  KeyType,
  MemberKey,
  Secp256r1Key,
  TransactionMessage,
  transactionMessageBeet,
} from "../types";
import { compileToWrappedMessageV0 } from "./compileToWrappedMessageV0";
import { program } from "./consts";

export function getProgramConfig() {
  const [programConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("program_config")],
    program.programId
  );

  return programConfigPda;
}

export function getDomainConfig(rpIdHash: Uint8Array) {
  const [domainConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("domain_config"), rpIdHash],
    program.programId
  );

  return domainConfig;
}

export function getDelegateAddress(walletAddress: PublicKey | Secp256r1Key) {
  if (isPublicKey(walletAddress)) {
    const [delegatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegate"), walletAddress.toBuffer()],
      program.programId
    );

    return delegatePda;
  } else if (walletAddress instanceof Secp256r1Key) {
    const [delegatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegate"), walletAddress.toTruncatedBuffer()],
      program.programId
    );

    return delegatePda;
  } else {
    throw new Error("Unable to parse Public Key");
  }
}

export function getSettingsFromCreateKey(createKey: PublicKey) {
  const [settings] = PublicKey.findProgramAddressSync(
    [Buffer.from("multi_wallet"), createKey.toBuffer()],
    program.programId
  );

  return settings;
}

export function getMultiWalletFromSettings(settings: PublicKey) {
  const [multiWallet] = PublicKey.findProgramAddressSync(
    [Buffer.from("multi_wallet"), settings.toBuffer(), Buffer.from("vault")],
    program.programId
  );
  return multiWallet;
}

export function getTransactionBufferAddress(
  settings: PublicKey,
  creator: PublicKey | Secp256r1Key,
  buffer_index: number
) {
  if (buffer_index > 255) {
    throw new Error("Index cannot be greater than 255.");
  }
  if (isPublicKey(creator)) {
    const [transactionBuffer] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("multi_wallet"),
        settings.toBuffer(),
        Buffer.from("transaction_buffer"),
        creator.toBuffer(),
        new BN(buffer_index).toArrayLike(Buffer, "le", 1),
      ],
      program.programId
    );
    return transactionBuffer;
  } else if (creator instanceof Secp256r1Key) {
    const [transactionBuffer] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("multi_wallet"),
        settings.toBuffer(),
        Buffer.from("transaction_buffer"),
        creator.toTruncatedBuffer(),
        new BN(buffer_index).toArrayLike(Buffer, "le", 1),
      ],
      program.programId
    );
    return transactionBuffer;
  } else {
    throw new Error("Unable to parse PublicKey.");
  }
}

export function isStaticWritableIndex(
  message: TransactionMessage,
  index: number
) {
  const numAccountKeys = message.accountKeys.length;
  const { numSigners, numWritableSigners, numWritableNonSigners } = message;

  if (index >= numAccountKeys) {
    // `index` is not a part of static `accountKeys`.
    return false;
  }

  if (index < numWritableSigners) {
    // `index` is within the range of writable signer keys.
    return true;
  }

  if (index >= numSigners) {
    // `index` is within the range of non-signer keys.
    const indexIntoNonSigners = index - numSigners;
    // Whether `index` is within the range of writable non-signer keys.
    return indexIntoNonSigners < numWritableNonSigners;
  }

  return false;
}

export function isSignerIndex(message: TransactionMessage, index: number) {
  return index < message.numSigners;
}

export function transactionMessageToCompileMessage({
  message,
  addressLookupTableAccounts,
}: {
  message: SolanaTransactionMessage;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
}) {
  const compiledMessage = compileToWrappedMessageV0({
    payerKey: message.payerKey.toString(),
    recentBlockhash: message.recentBlockhash,
    instructions: message.instructions,
    addressLookupTableAccounts,
  });

  return compiledMessage;
}

export function transactionMessageSerialize(compiledMessage: MessageV0) {
  const [transactionMessageBytes] = transactionMessageBeet.serialize({
    numSigners: compiledMessage.header.numRequiredSignatures,
    numWritableSigners:
      compiledMessage.header.numRequiredSignatures -
      compiledMessage.header.numReadonlySignedAccounts,
    numWritableNonSigners:
      compiledMessage.staticAccountKeys.length -
      compiledMessage.header.numRequiredSignatures -
      compiledMessage.header.numReadonlyUnsignedAccounts,
    accountKeys: compiledMessage.staticAccountKeys,
    instructions: compiledMessage.compiledInstructions.map((ix) => {
      return {
        programIdIndex: ix.programIdIndex,
        accountIndexes: ix.accountKeyIndexes,
        data: Array.from(ix.data),
      };
    }),
    addressTableLookups: compiledMessage.addressTableLookups,
  });
  return transactionMessageBytes;
}

/** Populate remaining accounts required for execution of the transaction. */
export async function accountsForTransactionExecute({
  connection,
  vaultPda,
  transactionMessage,
  message,
}: {
  connection: Connection;
  message: MessageV0;
  transactionMessage: TransactionMessage;
  vaultPda: PublicKey;
}): Promise<{
  /** Account metas used in the `message`. */
  accountMetas: AccountMeta[];
  /** Address lookup table accounts used in the `message`. */
  lookupTableAccounts: AddressLookupTableAccount[];
}> {
  const addressLookupTableKeys = message.addressTableLookups.map(
    ({ accountKey }) => accountKey
  );
  const addressLookupTableAccounts: Map<string, AddressLookupTableAccount> =
    new Map(
      await Promise.all(
        addressLookupTableKeys.map(async (key) => {
          const { value } = await connection.getAddressLookupTable(key);
          if (!value) {
            throw new Error(
              `Address lookup table account ${key.toBase58()} not found`
            );
          }
          return [key.toBase58(), value] as const;
        })
      )
    );

  // Populate account metas required for execution of the transaction.
  const accountMetas: AccountMeta[] = [];
  // First add the lookup table accounts used by the transaction. They are needed for on-chain validation.
  accountMetas.push(
    ...addressLookupTableKeys.map((key) => {
      return { pubkey: key, isSigner: false, isWritable: false };
    })
  );
  // Then add static account keys included into the message.
  for (const [
    accountIndex,
    accountKey,
  ] of message.staticAccountKeys.entries()) {
    accountMetas.push({
      pubkey: accountKey,
      isWritable: isStaticWritableIndex(transactionMessage, accountIndex),
      // NOTE: vaultPda cannot be marked as signers,
      // because they are PDAs and hence won't have their signatures on the transaction.
      isSigner:
        isSignerIndex(transactionMessage, accountIndex) &&
        !accountKey.equals(vaultPda),
    });
  }
  // Then add accounts that will be loaded with address lookup tables.
  for (const lookup of message.addressTableLookups) {
    const lookupTableAccount = addressLookupTableAccounts.get(
      lookup.accountKey.toBase58()
    );
    invariant(
      lookupTableAccount,
      `Address lookup table account ${lookup.accountKey.toBase58()} not found`
    );

    for (const accountIndex of lookup.writableIndexes) {
      const pubkey: PublicKey =
        lookupTableAccount.state.addresses[accountIndex];
      invariant(
        pubkey,
        `Address lookup table account ${lookup.accountKey.toBase58()} does not contain address at index ${accountIndex}`
      );
      accountMetas.push({
        pubkey,
        isWritable: true,
        // Accounts in address lookup tables can not be signers.
        isSigner: false,
      });
    }
    for (const accountIndex of lookup.readonlyIndexes) {
      const pubkey: PublicKey =
        lookupTableAccount.state.addresses[accountIndex];
      invariant(
        pubkey,
        `Address lookup table account ${lookup.accountKey.toBase58()} does not contain address at index ${accountIndex}`
      );
      accountMetas.push({
        pubkey,
        isWritable: false,
        // Accounts in address lookup tables can not be signers.
        isSigner: false,
      });
    }
  }

  return {
    accountMetas,
    lookupTableAccounts: [...addressLookupTableAccounts.values()],
  };
}

export const estimateJitoTips = async (
  level = "ema_landed_tips_50th_percentile"
) => {
  const response = await fetch(
    "https://bundles.jito.wtf/api/v1/bundles/tip_floor"
  );
  const result = await response.json();
  const tipAmount = Math.round(result[0][level] * LAMPORTS_PER_SOL) as number;

  return tipAmount;
};

export async function simulateTransaction(
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: AddressLookupTableAccount[] = [],
  replaceRecentBlockhash = true,
  sigVerify = false,
  innerInstructions = true
) {
  const testVersionedTxn = new VersionedTransaction(
    new SolanaTransactionMessage({
      instructions,
      payerKey: payer,
      recentBlockhash: PublicKey.default.toString(),
    }).compileToV0Message(lookupTables)
  );
  const simulation = await connection.simulateTransaction(testVersionedTxn, {
    replaceRecentBlockhash,
    sigVerify,
    innerInstructions,
  });
  return simulation;
}

export function bufferToBase64URLString(buffer: any) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const charCode of bytes) {
    str += String.fromCharCode(charCode);
  }
  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64URLStringToBuffer(base64URLString) {
  // Convert from Base64URL to Base64
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  /**
   * Pad with '=' until it's a multiple of four
   * (4 - (85 % 4 = 1) = 3) % 4 = 3 padding
   * (4 - (86 % 4 = 2) = 2) % 4 = 2 padding
   * (4 - (87 % 4 = 3) = 1) % 4 = 1 padding
   * (4 - (88 % 4 = 0) = 4) % 4 = 0 padding
   */
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  // Convert to a binary string
  const binary = atob(padded);
  // Convert binary string to buffer
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

export function convertPubkeyToMemberkey(
  pubkey: PublicKey | Secp256r1Key
): MemberKey {
  if (pubkey instanceof Secp256r1Key) {
    return { keyType: KeyType.Secp256r1, key: pubkey.toBuffer() };
  }
  try {
    new PublicKey(pubkey);
    return { keyType: KeyType.Ed25519, key: pubkey.toBuffer() };
  } catch (e) {
    throw new Error("Unable to parse pubkey type");
  }
}

export function convertMemberkeyToPubKey(
  pubkey: MemberKey
): PublicKey | Secp256r1Key {
  if (pubkey.keyType === KeyType.Ed25519) {
    return new PublicKey(pubkey.key);
  } else {
    return new Secp256r1Key(pubkey.key);
  }
}

export function isPublicKey(pubkey: PublicKey | Secp256r1Key) {
  if (pubkey instanceof Secp256r1Key) {
    return false;
  }
  try {
    new PublicKey(pubkey);
    return true;
  } catch (error) {
    return false;
  }
}

export function isEquals(
  publicKey: PublicKey | Secp256r1Key,
  memberKey: MemberKey
) {
  const xIsPublicKey = isPublicKey(publicKey);
  const yIsPublicKey = memberKey.keyType === KeyType.Ed25519;

  if ((xIsPublicKey && yIsPublicKey) || (!xIsPublicKey && !yIsPublicKey)) {
    return publicKey.toBuffer().every((value, i) => value === memberKey.key[i]);
  } else {
    return false;
  }
}
