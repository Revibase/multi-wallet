import {
  AccountRole,
  address,
  Address,
  fetchAddressesForLookupTables,
  getAddressEncoder,
  getSignersFromInstruction,
  IAccountMeta,
  IAccountSignerMeta,
  IInstruction,
  OptionOrNullable,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import {
  ConfigAction,
  IPermissions,
  MemberKey,
  MemberWithVerifyArgs,
  Secp256r1VerifyArgs,
} from "../generated";
import { ConfigActionWrapper, KeyType, Secp256r1Key } from "../types";
import {
  CustomTransactionMessage,
  customTransactionMessageDeserialize,
} from "./customTransactionMessage";
import { getMemberKeyString } from "./helper";

export async function getHash(text: string) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  );
  return hash;
}
function getAccountRole(
  message: CustomTransactionMessage,
  index: number,
  accountKey: Address,
  vaultPda: Address
) {
  const isWritable = isStaticWritableIndex(message, index);
  const isSigner = isSignerIndex(message, index) && accountKey !== vaultPda;
  if (isWritable && isSigner) {
    return AccountRole.WRITABLE_SIGNER;
  } else if (isWritable && !isSigner) {
    return AccountRole.WRITABLE;
  } else if (!isWritable && isSigner) {
    return AccountRole.READONLY_SIGNER;
  } else {
    return AccountRole.READONLY;
  }
}
function isStaticWritableIndex(
  message: CustomTransactionMessage,
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
function isSignerIndex(message: CustomTransactionMessage, index: number) {
  return index < message.numSigners;
}
/** Populate remaining accounts required for execution of the transaction. */

export async function accountsForTransactionExecute({
  rpc,
  multiWallet,
  transactionMessageBytes,
  additionalSigners: additionalSigners,
}: {
  rpc: Rpc<SolanaRpcApi>;
  transactionMessageBytes: Uint8Array;
  multiWallet: Address;
  additionalSigners?: TransactionSigner[];
}) {
  const message = customTransactionMessageDeserialize(transactionMessageBytes);

  let addressTableLookups:
    | Readonly<{
        lookupTableAddress: Address;
        readableIndices: readonly number[];
        writableIndices: readonly number[];
      }>[]
    | undefined = [];

  const addressLookupTableAccounts = await fetchAddressesForLookupTables(
    addressTableLookups?.map((x) => x.lookupTableAddress) || [],
    rpc
  );

  // Populate account metas required for execution of the transaction.
  const accountMetas: (IAccountMeta | IAccountSignerMeta)[] = [];
  // First add the lookup table accounts used by the transaction. They are needed for on-chain validation.
  accountMetas.push(
    ...(addressTableLookups?.map((key) => {
      return {
        role: AccountRole.READONLY,
        address: key.lookupTableAddress,
      };
    }) ?? [])
  );
  // Then add static account keys included into the message.
  for (const [accountIndex, accountKey] of message.accountKeys.entries()) {
    accountMetas.push({
      address: accountKey,
      role: getAccountRole(message, accountIndex, accountKey, multiWallet),
    });
  }
  // Then add accounts that will be loaded with address lookup tables.
  for (const lookup of addressTableLookups || []) {
    const lookupTableAccount =
      addressLookupTableAccounts[lookup.lookupTableAddress];
    if (!lookupTableAccount) {
      throw new Error(
        `Address lookup table account ${lookup.lookupTableAddress} not found`
      );
    }

    for (const accountIndex of lookup.writableIndices) {
      const address: Address = lookupTableAccount[accountIndex];
      if (!address) {
        throw new Error(
          `Address lookup table account ${lookup.lookupTableAddress} does not contain address at index ${accountIndex}`
        );
      }

      accountMetas.push({
        address,
        role: AccountRole.WRITABLE,
      });
    }
    for (const accountIndex of lookup.readableIndices) {
      const address = lookupTableAccount[accountIndex];
      if (address) {
        throw new Error(
          `Address lookup table account ${lookup.lookupTableAddress} does not contain address at index ${accountIndex}`
        );
      }
      accountMetas.push({
        address,
        role: AccountRole.READONLY,
      });
    }
  }

  for (const signer of additionalSigners?.filter(
    (x) => x.address !== multiWallet
  ) ?? []) {
    const index = accountMetas.findIndex(
      (meta) => meta.address === signer.address
    );
    if (index === -1) {
      accountMetas.push({
        address: signer.address,
        role: AccountRole.READONLY_SIGNER,
        signer,
      });
    } else {
      if (
        accountMetas[index].role === AccountRole.READONLY ||
        accountMetas[index].role === AccountRole.READONLY_SIGNER
      ) {
        accountMetas[index] = {
          address: signer.address,
          role: AccountRole.READONLY_SIGNER,
          signer,
        };
      } else if (
        accountMetas[index].role === AccountRole.WRITABLE ||
        accountMetas[index].role === AccountRole.WRITABLE_SIGNER
      ) {
        accountMetas[index] = {
          address: signer.address,
          role: AccountRole.WRITABLE_SIGNER,
          signer,
        };
      }
    }
  }
  return {
    accountMetas,
    addressLookupTableAccounts,
    message,
    addressTableLookups,
  };
}
export function convertPubkeyToMemberkey(
  pubkey: Address | Secp256r1Key
): MemberKey {
  if (pubkey instanceof Secp256r1Key) {
    return { keyType: KeyType.Secp256r1, key: pubkey.toBytes() };
  } else {
    return {
      keyType: KeyType.Ed25519,
      key: new Uint8Array([
        0, // pad start with zero to make it 33 bytes
        ...getAddressEncoder().encode(pubkey as Address),
      ]),
    };
  }
}
export function convertMemberkeyToPubKey(
  pubkey: MemberKey
): Address | Secp256r1Key {
  if (pubkey.keyType === KeyType.Ed25519) {
    return address(getMemberKeyString(pubkey));
  } else {
    return new Secp256r1Key(getMemberKeyString(pubkey));
  }
}
export function deduplicateSignersAndFeePayer(
  instruction: IInstruction,
  feePayer: TransactionSigner
): Address[] {
  const signers = getSignersFromInstruction(instruction)
    .filter((x) => x.address !== feePayer.address)
    .concat([feePayer]);
  return signers.map((x) => x.address);
}
export function normalizeKey(key: any) {
  if (key instanceof Uint8Array) return key;
  if (Array.isArray(key)) return new Uint8Array(key);
  if (typeof key === "object" && key !== null)
    return new Uint8Array(Object.values(key));
  throw new Error("Invalid key format");
}
export function extractSecp256r1VerificationArgs(
  pubKey?: Secp256r1Key | TransactionSigner
): {
  slotHashSysvar: Address | undefined;
  domainConfig: Address | undefined;
  verifyArgs: OptionOrNullable<Secp256r1VerifyArgs>;
} {
  const secp256r1PublicKey =
    pubKey instanceof Secp256r1Key ? pubKey : undefined;
  const verifyArgs: OptionOrNullable<Secp256r1VerifyArgs> =
    secp256r1PublicKey?.verifyArgs
      ? { __option: "Some", value: secp256r1PublicKey.verifyArgs }
      : { __option: "None" };
  const slotHashSysvar = secp256r1PublicKey?.verifyArgs
    ? address("SysvarS1otHashes111111111111111111111111111")
    : undefined;
  const domainConfig = secp256r1PublicKey?.verifyArgs
    ? secp256r1PublicKey?.domainConfig
    : undefined;
  return { slotHashSysvar, domainConfig, verifyArgs };
}
export function getDeduplicatedSigners(
  signers: (Secp256r1Key | TransactionSigner)[]
) {
  const hashSet = new Set();
  const dedupSigners: (Secp256r1Key | TransactionSigner)[] = [];
  for (const signer of signers) {
    if (
      !(signer instanceof Secp256r1Key
        ? hashSet.has(signer.toString())
        : hashSet.has(signer.address.toString()))
    ) {
      dedupSigners.push(signer);
      hashSet.add(getPubkeyString(signer));
    }
  }

  if (dedupSigners.filter((x) => x instanceof Secp256r1Key).length > 1) {
    throw new Error("More than 1 Secp256r1 signers is not supported.");
  }
  return dedupSigners;
}
export function convertConfigActionWrapper(
  configActionsWrapper: ConfigActionWrapper[]
) {
  const configActions: ConfigAction[] = [];
  for (const action of configActionsWrapper) {
    switch (action.type) {
      case "AddMembers":
        const addMembers: MemberWithVerifyArgs[] = [];
        for (const x of action.members) {
          addMembers.push(convertMember(x));
        }
        configActions.push({
          __kind: "AddMembers",
          fields: [addMembers],
        });
        break;
      case "RemoveMembers":
        configActions.push({
          __kind: "RemoveMembers",
          fields: [action.members.map(convertPubkeyToMemberkey)],
        });
        break;
      case "SetMembers":
        const setMembers: MemberWithVerifyArgs[] = [];
        for (const x of action.members) {
          setMembers.push(convertMember(x));
        }
        configActions.push({
          __kind: "SetMembers",
          fields: [setMembers],
        });
        break;
      case "SetThreshold":
        configActions.push({
          __kind: "SetThreshold",
          fields: [action.threshold],
        });
        break;
      case "SetMetadata":
        configActions.push({
          __kind: "SetMetadata",
          fields: [
            action.metadata
              ? { __option: "Some", value: action.metadata }
              : { __option: "None" },
          ],
        });
        break;
    }
  }

  return configActions;
}

export function convertMember(x: {
  pubkey: Address | Secp256r1Key;
  permissions: IPermissions;
  metadata: Address | null;
}): MemberWithVerifyArgs {
  return {
    data: {
      permissions: x.permissions,
      metadata: x.metadata
        ? {
            __option: "Some",
            value: x.metadata,
          }
        : { __option: "None" },
      pubkey: convertPubkeyToMemberkey(x.pubkey),
    },
    verifyArgs:
      x.pubkey instanceof Secp256r1Key && x.pubkey.verifyArgs
        ? {
            __option: "Some",
            value: x.pubkey.verifyArgs,
          }
        : {
            __option: "None",
          },
  };
}
export function getPubkeyString(pubkey: TransactionSigner | Secp256r1Key) {
  if (pubkey instanceof Secp256r1Key) {
    return pubkey.toString();
  } else {
    return pubkey.address.toString();
  }
}
