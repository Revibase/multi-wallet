import type { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import BN from "bn.js";
import {
  AccountRole,
  type AccountSignerMeta,
  type Address,
  createNoopSigner,
  none,
  some,
  type TransactionSigner,
} from "gill";
import {
  type AddMemberArgs,
  type CompressedSettings,
  type ConfigAction,
  DelegateOp,
  type DelegateOpArgs,
  type EditMemberArgs,
  getChangeConfigCompressedInstruction,
  getChangeConfigInstructionAsync,
  getCompressedSettingsDecoder,
  getUserDecoder,
  type IPermissions,
  type RemoveMemberArgs,
  type SettingsIndexWithAddressArgs,
  type SettingsMutArgs,
  type User,
  type UserMutArgs,
} from "../generated";
import {
  type ConfigurationArgs,
  type IPermission,
  PermanentMemberPermission,
  Permission,
  type PermissionArgs,
  Permissions,
  Secp256r1Key,
  SignedSecp256r1Key,
  TransactionManagerPermission,
  type UserAccountWithAddressArgs,
} from "../types";
import {
  convertMemberKeyToString,
  fetchSettingsAccountData,
  getCompressedSettingsAddressFromIndex,
  getUserAccountAddress,
  getWalletAddressFromIndex,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import {
  convertPubkeyToMemberkey,
  extractSecp256r1VerificationArgs,
} from "../utils/transaction/internal";
import type { Secp256r1VerifyInput } from "./secp256r1Verify";

export async function changeConfig({
  settingsIndexWithAddressArgs,
  configActionsArgs,
  payer,
  compressed = false,
  cachedAccounts,
}: {
  settingsIndexWithAddressArgs: SettingsIndexWithAddressArgs;
  configActionsArgs: ConfigurationArgs[];
  payer: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  const { index } = settingsIndexWithAddressArgs;
  // --- Stage 1: Setup Addresses---
  const authority = await getWalletAddressFromIndex(index);

  const addDelegates: { address: BN; type: "User" }[] = [];
  const removeDelegates: { address: BN; type: "User" }[] = [];

  for (const action of configActionsArgs) {
    if (action.type === "AddMembers") {
      addDelegates.push(
        ...(await Promise.all(
          action.members.map(async (m) =>
            m.account.member instanceof SignedSecp256r1Key
              ? {
                  address: (
                    await getUserAccountAddress({
                      member: m.account.member,
                      userAddressTreeIndex: m.account.userAddressTreeIndex,
                    })
                  ).address,
                  type: "User" as const,
                }
              : m.setAsDelegate
                ? {
                    address: (
                      await getUserAccountAddress({
                        member: m.account.member.address,
                        userAddressTreeIndex: m.account.userAddressTreeIndex,
                      })
                    ).address,
                    type: "User" as const,
                  }
                : {
                    address: (
                      await getUserAccountAddress({
                        member: m.account.member,
                        userAddressTreeIndex: m.account.userAddressTreeIndex,
                      })
                    ).address,
                    type: "User" as const,
                  }
          )
        ))
      );
    } else if (action.type === "RemoveMembers") {
      removeDelegates.push(
        ...(await Promise.all(
          action.members.map(async (m) => ({
            address: (await getUserAccountAddress(m)).address,
            type: "User" as const,
          }))
        ))
      );
    } else if (action.type === "EditPermissions") {
      for (const m of action.members) {
        if (m.delegateOperation !== DelegateOp.Ignore) {
          (m.delegateOperation === DelegateOp.Add
            ? addDelegates
            : removeDelegates
          ).push({
            address: (await getUserAccountAddress(m.account)).address,
            type: "User" as const,
          });
        }
      }
    }
  }

  // --- Stage 2: Proof preparation ---
  const packedAccounts = new PackedAccounts();
  let proof: ValidityProofWithContext | null = null;
  let settingsMutArgs: SettingsMutArgs | null = null;
  let userMutArgs: UserMutArgs[] = [];

  if (addDelegates.length || removeDelegates.length || compressed) {
    await packedAccounts.addSystemAccounts();

    const addresses = [
      ...(compressed
        ? [
            {
              address: (
                await getCompressedSettingsAddressFromIndex(
                  settingsIndexWithAddressArgs
                )
              ).address,
              type: "Settings" as const,
            },
          ]
        : []),
      ...removeDelegates,
      ...addDelegates,
    ];

    const hashesWithTree = addresses.length
      ? await getCompressedAccountHashes(addresses, cachedAccounts)
      : [];

    if (hashesWithTree.length) {
      proof = await getValidityProofWithRetry(hashesWithTree, []);

      const settingsHashes = hashesWithTree.filter(
        (x) => x.type === "Settings"
      );
      const userHashes = hashesWithTree.filter((x) => x.type === "User");

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

      if (userHashes.length && proof) {
        userMutArgs = getCompressedAccountMutArgs<User>(
          packedAccounts,
          proof.treeInfos.slice(compressed ? 1 : 0),
          proof.leafIndices.slice(compressed ? 1 : 0),
          proof.rootIndices.slice(compressed ? 1 : 0),
          proof.proveByIndices.slice(compressed ? 1 : 0),
          userHashes,
          getUserDecoder()
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
        const field: AddMemberArgs[] = [];
        for (const m of action.members) {
          if (m.account.member instanceof SignedSecp256r1Key) {
            const index = secp256r1VerifyInput.length;
            const { message, signature, publicKey, domainConfig } =
              extractSecp256r1VerificationArgs(m.account.member, index);

            if (message && signature && publicKey) {
              secp256r1VerifyInput.push({ message, signature, publicKey });
            }

            if (domainConfig) {
              packedAccounts.addPreAccounts([
                { address: domainConfig, role: AccountRole.READONLY },
              ]);
            }

            const userArgs = await getUserArgs(
              {
                member: m.account.member,
                userAddressTreeIndex: m.account.userAddressTreeIndex,
              },
              userMutArgs
            );
            if (userArgs) {
              field.push(
                convertAddMember({
                  permissionArgs: m.permissions,
                  index,
                  userMutArgs: userArgs,
                  isTransactionManager: m.isTransactionManager,
                  pubkey: m.account.member,
                  setAsDelegate: m.setAsDelegate,
                })
              );
            }
          } else {
            if (m.setAsDelegate) {
              packedAccounts.addPreAccounts([
                {
                  address: m.account.member.address,
                  role: AccountRole.READONLY_SIGNER,
                  signer: m.account.member,
                } as AccountSignerMeta,
              ]);
            }

            const userArgs = await getUserArgs(
              {
                member: m.setAsDelegate
                  ? m.account.member.address
                  : m.account.member,
                userAddressTreeIndex: m.account.userAddressTreeIndex,
              },
              userMutArgs
            );
            if (userArgs) {
              field.push(
                convertAddMember({
                  permissionArgs: m.permissions,
                  index: -1,
                  userMutArgs: userArgs,
                  isTransactionManager: m.isTransactionManager,
                  pubkey: m.account.member,
                  setAsDelegate: m.setAsDelegate,
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
            const userArgs = await getUserArgs(m, userMutArgs);
            if (!userArgs) throw new Error("User account not found");
            return convertRemoveMember({
              pubkey: m.member,
              userMutArgs: userArgs,
            });
          })
        );
        configActions.push({
          __kind: action.type,
          fields: [field],
        });
        break;
      }

      case "EditPermissions": {
        const settingsData = await fetchSettingsAccountData(
          settingsIndexWithAddressArgs,
          cachedAccounts
        );
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
                m.account.member.toString();
            const isTransactionManager =
              !!transactionManager?.pubkey &&
              convertMemberKeyToString(transactionManager.pubkey) ===
                m.account.member.toString();

            if (isTransactionManager) {
              throw new Error(
                "Transaction Manager's permission cannot be changed."
              );
            }

            const userArgs =
              m.delegateOperation !== DelegateOp.Ignore
                ? await getUserArgs(m.account, userMutArgs)
                : undefined;

            return convertEditMember({
              permissionArgs: m.permissions,
              isPermanentMember,
              userMutArgs: userArgs,
              pubkey: m.account.member,
              delegateOperation: m.delegateOperation,
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
          authority: createNoopSigner(authority),
          compressedProofArgs,
          settingsMut: settingsMutArgs!,
          remainingAccounts,
        }),
      ]
    : [
        await getChangeConfigInstructionAsync({
          settingsIndex: index,
          configActions,
          payer,
          compressedProofArgs,
          remainingAccounts,
        }),
      ];

  return { instructions, secp256r1VerifyInput };
}

async function getUserArgs(
  account: UserAccountWithAddressArgs,
  userMutArgs: UserMutArgs[]
): Promise<UserMutArgs | undefined> {
  const { address } = await getUserAccountAddress(account);
  const mutArg = userMutArgs.find((arg) =>
    new BN(new Uint8Array(arg.accountMeta.address)).eq(address)
  );
  return mutArg;
}

function convertEditMember({
  pubkey,
  permissionArgs,
  userMutArgs,
  delegateOperation,
  isPermanentMember,
}: {
  pubkey: Address | Secp256r1Key;
  permissionArgs: PermissionArgs;
  isPermanentMember: boolean;
  userMutArgs?: UserMutArgs;
  delegateOperation: DelegateOpArgs;
}): EditMemberArgs {
  if (isPermanentMember) {
    if (userMutArgs || delegateOperation !== DelegateOp.Ignore) {
      throw new Error("Delegation cannot be modified for a permanent member.");
    }
  }
  const permissions = convertPermissions(permissionArgs, isPermanentMember);

  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    permissions,
    userArgs: userMutArgs ? some(userMutArgs) : none(),
    delegateOperation,
  };
}

function convertRemoveMember({
  pubkey,
  userMutArgs,
}: {
  pubkey: Address | Secp256r1Key;
  userMutArgs: UserMutArgs;
}): RemoveMemberArgs {
  const userAccountData = userMutArgs.data;
  const isPermanentMember = userAccountData.isPermanentMember;
  if (isPermanentMember) {
    throw new Error("Permanent Member cannot be removed from the wallet.");
  }
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    userArgs:
      userMutArgs.data.delegatedTo.__option === "Some"
        ? { __kind: "Mutate", fields: [userMutArgs] }
        : { __kind: "Read", fields: [userMutArgs] },
  };
}

function convertAddMember({
  pubkey,
  permissionArgs,
  index,
  userMutArgs,
  setAsDelegate,
  isTransactionManager,
}: {
  pubkey: TransactionSigner | SignedSecp256r1Key | Address;
  permissionArgs: PermissionArgs;
  index: number;
  userMutArgs: UserMutArgs;
  setAsDelegate: boolean;
  isTransactionManager: boolean;
}): AddMemberArgs {
  const permissions = getAddMemberPermission(
    userMutArgs,
    setAsDelegate,
    permissionArgs,
    isTransactionManager
  );
  return {
    member: {
      permissions,
      pubkey: convertPubkeyToMemberkey(pubkey),
      userAddressTreeIndex: userMutArgs.data.userAddressTreeIndex,
    },
    verifyArgs:
      pubkey instanceof SignedSecp256r1Key && pubkey.verifyArgs && index !== -1
        ? some({
            truncatedClientDataJson: pubkey.verifyArgs.truncatedClientDataJson,
            slotNumber: pubkey.verifyArgs.slotNumber,
            signedMessageIndex: index,
            originIndex: pubkey.originIndex,
            crossOrigin: pubkey.crossOrigin,
          })
        : none(),
    userArgs: setAsDelegate
      ? { __kind: "Mutate", fields: [userMutArgs] }
      : { __kind: "Read", fields: [userMutArgs] },
    setAsDelegate,
  };
}

function getAddMemberPermission(
  userMutArgs: UserMutArgs,
  setAsDelegate: boolean,
  permissionArgs: PermissionArgs,
  isTransactionManager: boolean
) {
  const userAccountData = userMutArgs.data;
  const isPermanentMember = userAccountData.isPermanentMember;
  if (isPermanentMember) {
    if (!setAsDelegate) {
      throw new Error(
        "Permanent members must also be delegates. Please set `setAsDelegate = true`."
      );
    }
    if (userAccountData.delegatedTo.__option === "Some") {
      throw new Error(
        "This user is already registered as a permanent member in another wallet. A permanent member can only belong to one wallet."
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

function convertPermissions(
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
