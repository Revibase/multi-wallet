import { getTransferSolInstruction } from "@solana-program/system";
import {
  AccountRole,
  Address,
  address,
  fetchAddressesForLookupTables,
  getAddressEncoder,
  GetMultipleAccountsApi,
  getSignersFromInstruction,
  IAccountMeta,
  IAccountSignerMeta,
  IInstruction,
  none,
  OptionOrNullable,
  Rpc,
  some,
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
import { JITO_TIP_ACCOUNTS } from "./consts";
import { convertMemberKeyToString } from "./helper";
import {
  CustomTransactionMessage,
  customTransactionMessageDeserialize,
} from "./transactionMessage";

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
  additionalSigners,
}: {
  rpc: Rpc<GetMultipleAccountsApi>;
  transactionMessageBytes: Uint8Array;
  multiWallet: Address;
  additionalSigners?: TransactionSigner[];
}) {
  const transactionMessage = customTransactionMessageDeserialize(
    transactionMessageBytes
  );

  const addressLookupTableAccounts = await fetchAddressesForLookupTables(
    transactionMessage.addressTableLookups.map((x) => x.accountKey),
    rpc
  );

  // Populate account metas required for execution of the transaction.
  const accountMetas: (IAccountMeta | IAccountSignerMeta)[] = [];
  // First add the lookup table accounts used by the transaction. They are needed for on-chain validation.
  accountMetas.push(
    ...(transactionMessage.addressTableLookups?.map((lookup) => {
      return {
        role: AccountRole.READONLY,
        address: lookup.accountKey,
      };
    }) ?? [])
  );
  // Then add static account keys included into the message.
  for (const [
    accountIndex,
    accountKey,
  ] of transactionMessage.accountKeys.entries()) {
    accountMetas.push({
      address: accountKey,
      role: getAccountRole(
        transactionMessage,
        accountIndex,
        accountKey,
        multiWallet
      ),
    });
  }
  // Then add accounts that will be loaded with address lookup tables.
  for (const lookup of transactionMessage.addressTableLookups) {
    const lookupTableAccount = addressLookupTableAccounts[lookup.accountKey];
    if (!lookupTableAccount) {
      throw new Error(
        `Address lookup table account ${lookup.accountKey} not found`
      );
    }

    for (const accountIndex of lookup.writableIndexes) {
      const address = lookupTableAccount[accountIndex];
      if (!address) {
        throw new Error(
          `Address lookup table account ${lookup.accountKey} does not contain address at index ${accountIndex}`
        );
      }

      accountMetas.push({
        address,
        role: AccountRole.WRITABLE,
      });
    }
    for (const accountIndex of lookup.readonlyIndexes) {
      const address = lookupTableAccount[accountIndex];
      if (!address) {
        throw new Error(
          `Address lookup table account ${lookup.accountKey} does not contain address at index ${accountIndex}`
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
    transactionMessage,
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
        ...getAddressEncoder().encode(pubkey),
      ]),
    };
  }
}
export function convertMemberkeyToPubKey(
  pubkey: MemberKey
): Address | Secp256r1Key {
  if (pubkey.keyType === KeyType.Ed25519) {
    return address(convertMemberKeyToString(pubkey));
  } else {
    return new Secp256r1Key(convertMemberKeyToString(pubkey));
  }
}
export function deduplicateSignersAndFeePayer(
  instructions: IInstruction[],
  feePayer: TransactionSigner
): Address[] {
  const signers = instructions
    .flatMap((instruction) => getSignersFromInstruction(instruction))
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
export async function extractSecp256r1VerificationArgs(
  signer?: Secp256r1Key | TransactionSigner
) {
  const secp256r1PublicKey =
    signer instanceof Secp256r1Key ? signer : undefined;
  const verifyArgs: OptionOrNullable<Secp256r1VerifyArgs> =
    secp256r1PublicKey?.verifyArgs ? some(secp256r1PublicKey.verifyArgs) : null;
  const instructionsSysvar =
    signer instanceof Secp256r1Key
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
  const publicKey = secp256r1PublicKey?.verifyArgs?.publicKey;
  const message =
    secp256r1PublicKey?.authData && secp256r1PublicKey.verifyArgs
      ? new Uint8Array([
          ...secp256r1PublicKey.authData,
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              secp256r1PublicKey.verifyArgs.clientDataJson
            )
          ),
        ])
      : undefined;

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
      case "EditPermissions":
        configActions.push({
          __kind: "EditPermissions",
          fields: [
            action.members.map((x) => ({
              pubkey: convertPubkeyToMemberkey(x.pubkey),
              permissions: x.permissions,
            })),
          ],
        });
        break;
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
      case "SetThreshold":
        configActions.push({
          __kind: "SetThreshold",
          fields: [action.threshold],
        });
        break;
    }
  }

  return configActions;
}

export function convertMember(x: {
  pubkey: Address | Secp256r1Key;
  permissions: IPermissions;
}): MemberWithVerifyArgs {
  return {
    data: {
      permissions: x.permissions,
      domainConfig:
        x.pubkey instanceof Secp256r1Key && x.pubkey.domainConfig
          ? some(x.pubkey.domainConfig)
          : none(),
      pubkey: convertPubkeyToMemberkey(x.pubkey),
    },
    verifyArgs:
      x.pubkey instanceof Secp256r1Key && x.pubkey.verifyArgs
        ? some(x.pubkey.verifyArgs)
        : none(),
  };
}
export function getPubkeyString(pubkey: TransactionSigner | Secp256r1Key) {
  if (pubkey instanceof Secp256r1Key) {
    return pubkey.toString();
  } else {
    return pubkey.address.toString();
  }
}

export function addJitoTip({
  feePayer,
  tipAmount,
}: {
  feePayer: TransactionSigner;
  tipAmount: number;
}) {
  const tipAccount =
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return getTransferSolInstruction({
    source: feePayer,
    destination: address(tipAccount),
    amount: tipAmount,
  });
}
