import type { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import BN from "bn.js";
import {
  AccountRole,
  type AccountSignerMeta,
  type Address,
  createNoopSigner,
  getAddressEncoder,
  none,
  some,
  type TransactionSigner,
} from "gill";
import {
  type CompressedSettings,
  type ConfigAction,
  type Delegate,
  type DelegateMutArgs,
  DelegateOp,
  type DelegateOpArgs,
  getChangeConfigCompressedInstruction,
  getChangeConfigInstruction,
  getCompressedSettingsDecoder,
  getDelegateDecoder,
  type MemberKey,
  type MemberKeyWithEditPermissionsArgs,
  type MemberKeyWithRemovePermissionsArgs,
  type MemberWithAddPermissionsArgs,
  type SettingsMutArgs,
} from "../generated";
import {
  type ConfigurationArgs,
  KeyType,
  PermanentMemberPermission,
  type PermissionArgs,
  Permissions,
  Secp256r1Key,
  TransactionManagerPermission,
} from "../types";
import {
  convertMemberKeyToString,
  fetchSettingsData,
  getCompressedSettingsAddressFromIndex,
  getDelegateAddress,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import {
  convertPermissions,
  getDelegateExtensionsAddress,
} from "../utils/helper";
import { extractSecp256r1VerificationArgs } from "../utils/internal";
import type { Secp256r1VerifyInput } from "./secp256r1Verify";

export async function changeConfig({
  index,
  configActionsArgs,
  payer,
  compressed = false,
  cachedAccounts,
}: {
  index: bigint | number;
  configActionsArgs: ConfigurationArgs[];
  payer: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  // --- Stage 1: Setup Addresses---
  const settings = await getSettingsFromIndex(index);
  const multiWallet = await getMultiWalletFromSettings(settings);

  const addDelegates: (Address<string> | Secp256r1Key)[] = [];
  const removeDelegates: (Address<string> | Secp256r1Key)[] = [];

  for (const action of configActionsArgs) {
    if (action.type === "AddMembers") {
      addDelegates.push(
        ...action.members.map((m) =>
          m.pubkey instanceof Secp256r1Key
            ? m.pubkey
            : m.setAsDelegate
              ? m.pubkey.address
              : m.pubkey
        )
      );
    } else if (action.type === "RemoveMembers") {
      removeDelegates.push(...action.members.map((m) => m.pubkey));
    } else if (action.type === "EditPermissions") {
      for (const m of action.members) {
        if (m.delegateOperation !== DelegateOp.Ignore) {
          (m.delegateOperation === DelegateOp.Add
            ? addDelegates
            : removeDelegates
          ).push(m.pubkey);
        }
      }
    }
  }

  // --- Stage 2: Proof preparation ---
  const packedAccounts = new PackedAccounts();
  let proof: ValidityProofWithContext | null = null;
  let settingsMutArgs: SettingsMutArgs | null = null;
  let delegateMutArgs: DelegateMutArgs[] = [];

  if (addDelegates.length || removeDelegates.length || compressed) {
    await packedAccounts.addSystemAccounts();

    const addresses = [
      ...(compressed
        ? [
            {
              address: getCompressedSettingsAddressFromIndex(index),
              type: "Settings" as const,
            },
          ]
        : []),
      ...removeDelegates.map((m) => ({
        address: getDelegateAddress(m),
        type: "Delegate" as const,
      })),
      ...addDelegates.map((m) => ({
        address: getDelegateAddress(m),
        type: "Delegate" as const,
      })),
    ];

    const hashesWithTree = addresses.length
      ? await getCompressedAccountHashes(addresses, cachedAccounts)
      : [];

    if (hashesWithTree.length) {
      proof = await getValidityProofWithRetry(hashesWithTree, []);

      const settingsHashes = hashesWithTree.filter(
        (x) => x.type === "Settings"
      );
      const delegateHashes = hashesWithTree.filter(
        (x) => x.type === "Delegate"
      );

      if (compressed && proof) {
        settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
          packedAccounts,
          proof.treeInfos.slice(0, 1),
          proof.leafIndices.slice(0, 1),
          proof.rootIndices.slice(0, 1),
          proof.proveByIndices.slice(0, 1),
          settingsHashes,
          getCompressedSettingsDecoder()
        )[0];
      }

      if (delegateHashes.length && proof) {
        delegateMutArgs = getCompressedAccountMutArgs<Delegate>(
          packedAccounts,
          proof.treeInfos.slice(compressed ? 1 : 0),
          proof.leafIndices.slice(compressed ? 1 : 0),
          proof.rootIndices.slice(compressed ? 1 : 0),
          proof.proveByIndices.slice(compressed ? 1 : 0),
          delegateHashes,
          getDelegateDecoder()
        );
      }
    }
  }
  // --- Stage 3: Build config actions ---
  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const configActions: ConfigAction[] = [];

  for (const action of configActionsArgs) {
    switch (action.type) {
      case "AddMembers": {
        const field: MemberWithAddPermissionsArgs[] = [];
        for (const m of action.members) {
          if (m.pubkey instanceof Secp256r1Key) {
            const index = secp256r1VerifyInput.length;
            const { message, signature, publicKey, domainConfig } =
              extractSecp256r1VerificationArgs(m.pubkey, index);

            if (message && signature && publicKey) {
              secp256r1VerifyInput.push({ message, signature, publicKey });
            }

            if (domainConfig) {
              packedAccounts.addPreAccounts([
                { address: domainConfig, role: AccountRole.READONLY },
              ]);
            }

            const delegateArgs = await getDelegateArgs(
              m.pubkey,
              delegateMutArgs
            );
            if (delegateArgs) {
              field.push(
                convertAddMember({
                  ...m,
                  permissionArgs: m.permissions,
                  index,
                  delegateArgs,
                })
              );
            }
          } else {
            if (m.setAsDelegate) {
              packedAccounts.addPreAccounts([
                {
                  address: m.pubkey.address,
                  role: AccountRole.READONLY_SIGNER,
                  signer: m.pubkey,
                } as AccountSignerMeta,
              ]);
            } else if (m.isTransactionManager) {
              packedAccounts.addPreAccounts([
                {
                  address: await getDelegateExtensionsAddress(m.pubkey),
                  role: AccountRole.READONLY,
                },
              ]);
            }

            const delegateArgs = await getDelegateArgs(
              m.setAsDelegate ? m.pubkey.address : m.pubkey,
              delegateMutArgs
            );
            if (delegateArgs) {
              field.push(
                convertAddMember({
                  ...m,
                  permissionArgs: m.permissions,
                  index: -1,
                  delegateArgs,
                })
              );
            }
          }
        }
        configActions.push({ __kind: action.type, fields: [field] });
        break;
      }

      case "RemoveMembers": {
        const field = await Promise.all(
          action.members.map(async (m) => {
            const delegateArgs = await getDelegateArgs(
              m.pubkey,
              delegateMutArgs
            );
            if (!delegateArgs) throw new Error("delegate account not found");
            return convertRemoveMember({ ...m, delegateArgs });
          })
        );
        configActions.push({
          __kind: action.type,
          fields: [field],
        });
        break;
      }

      case "EditPermissions": {
        const settingsData = await fetchSettingsData(index, cachedAccounts);
        const permanentMember = settingsData.members.find((x) =>
          Permissions.has(x.permissions, PermanentMemberPermission)
        );
        const transactionManager = settingsData.members.find((x) =>
          Permissions.has(x.permissions, TransactionManagerPermission)
        );
        const field = await Promise.all(
          action.members.map(async (m) => {
            const isPermanentMember =
              !!permanentMember?.pubkey &&
              convertMemberKeyToString(permanentMember.pubkey) ===
                m.pubkey.toString();
            const isTransactionManager =
              !!transactionManager?.pubkey &&
              convertMemberKeyToString(transactionManager.pubkey) ===
                m.pubkey.toString();

            if (isTransactionManager) {
              throw new Error(
                "Transaction Manager's permission cannot be changed."
              );
            }

            const delegateArgs =
              m.delegateOperation !== DelegateOp.Ignore
                ? await getDelegateArgs(m.pubkey, delegateMutArgs)
                : undefined;

            return convertEditMember({
              ...m,
              permissionArgs: m.permissions,
              isPermanentMember,
              delegateArgs,
            });
          })
        );
        configActions.push({ __kind: action.type, fields: [field] });
        break;
      }

      default:
        configActions.push({ __kind: action.type, fields: [action.threshold] });
    }
  }

  // --- Stage 4: Instruction assembly ---
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);
  const instructions = compressed
    ? [
        getChangeConfigCompressedInstruction({
          configActions,
          payer,
          authority: createNoopSigner(multiWallet),
          compressedProofArgs,
          settingsMut: settingsMutArgs!,
          remainingAccounts,
        }),
      ]
    : [
        getChangeConfigInstruction({
          settingsIndex: index,
          configActions,
          settings,
          payer,
          authority: createNoopSigner(multiWallet),
          compressedProofArgs,
          remainingAccounts,
        }),
      ];

  return { instructions, secp256r1VerifyInput };
}

async function getDelegateArgs(
  pubkey: Address | Secp256r1Key,
  delegateMutArgs: DelegateMutArgs[]
): Promise<DelegateMutArgs | undefined> {
  const delegateAddress = getDelegateAddress(pubkey);
  const mutArg = delegateMutArgs.find((arg) =>
    new BN(new Uint8Array(arg.accountMeta.address)).eq(delegateAddress)
  );
  return mutArg;
}

function convertEditMember({
  pubkey,
  permissionArgs,
  delegateArgs,
  delegateOperation,
  isPermanentMember,
}: {
  pubkey: Address | Secp256r1Key;
  permissionArgs: PermissionArgs;
  isPermanentMember: boolean;
  delegateArgs?: DelegateMutArgs;
  delegateOperation: DelegateOpArgs;
}): MemberKeyWithEditPermissionsArgs {
  if (isPermanentMember) {
    if (delegateArgs || delegateOperation !== DelegateOp.Ignore) {
      throw new Error(
        "Delegation cannot be modified for a permanent member. Permanent members must always remain delegates."
      );
    }
  }
  const permissions = convertPermissions(permissionArgs, isPermanentMember);

  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    permissions,
    delegateArgs: delegateArgs ? some(delegateArgs) : none(),
    delegateOperation,
  };
}

function convertRemoveMember({
  pubkey,
  delegateArgs,
}: {
  pubkey: Address | Secp256r1Key;
  delegateArgs: DelegateMutArgs;
}): MemberKeyWithRemovePermissionsArgs {
  const delegateData = delegateArgs.data;
  const isPermanentMember = delegateData.isPermanentMember;
  if (isPermanentMember) {
    throw new Error("Permanent Member cannot be removed from the wallet.");
  }
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    delegateArgs: delegateArgs,
  };
}

function convertAddMember({
  pubkey,
  permissionArgs,
  index,
  delegateArgs,
  setAsDelegate,
  isTransactionManager,
}: {
  pubkey: TransactionSigner | Secp256r1Key | Address;
  permissionArgs: PermissionArgs;
  index: number;
  delegateArgs: DelegateMutArgs;
  setAsDelegate: boolean;
  isTransactionManager: boolean;
}): MemberWithAddPermissionsArgs {
  const permissions = getAddMemberPermission(
    delegateArgs,
    setAsDelegate,
    permissionArgs,
    isTransactionManager
  );
  return {
    member: {
      permissions,
      pubkey: convertPubkeyToMemberkey(
        pubkey instanceof Secp256r1Key
          ? pubkey
          : setAsDelegate
            ? (pubkey as TransactionSigner).address
            : (pubkey as Address)
      ),
    },
    verifyArgs:
      pubkey instanceof Secp256r1Key && pubkey.verifyArgs && index !== -1
        ? some({
            clientDataJson: pubkey.verifyArgs.clientDataJson,
            slotNumber: pubkey.verifyArgs.slotNumber,
            signedMessageIndex: index,
          })
        : none(),
    delegateArgs: delegateArgs,
    setAsDelegate,
  };
}

function convertPubkeyToMemberkey(pubkey: Address | Secp256r1Key): MemberKey {
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

function getAddMemberPermission(
  delegateMutArgs: DelegateMutArgs,
  setAsDelegate: boolean,
  permissionArgs: PermissionArgs,
  isTransactionManager: boolean
) {
  const delegateData = delegateMutArgs.data;
  const isPermanentMember = delegateData.isPermanentMember;
  if (isPermanentMember) {
    if (!setAsDelegate) {
      throw new Error(
        "Permanent members must also be delegates. Please set `setAsDelegate = true`."
      );
    }
    if (delegateData.settingsIndex.__option === "Some") {
      throw new Error(
        "This delegate is already registered as a permanent member in another wallet. A permanent member can only belong to one wallet."
      );
    }
  }

  if (isTransactionManager) {
    if (permissionArgs.execute || permissionArgs.vote) {
      throw new Error("Transaction Manager can only have initiate permission");
    }
    if (setAsDelegate) {
      throw new Error(
        "Transaction Manager cannot be a delegate. Please set `setAsDelegate = false`."
      );
    }
  }

  const permissions = convertPermissions(
    permissionArgs,
    isPermanentMember,
    isTransactionManager
  );
  return permissions;
}
