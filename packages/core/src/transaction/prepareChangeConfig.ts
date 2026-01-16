import {
  encodeBN254toBase58,
  type BN254,
  type ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import { equalBytes } from "@noble/curves/utils.js";
import { getBase58Encoder, type Address } from "gill";
import {
  getCompressedSettingsDecoder,
  getUserDecoder,
  UserRole,
  type AddMemberArgs,
  type CompressedSettings,
  type ConfigAction,
  type EditMemberArgs,
  type IPermissions,
  type RemoveMemberArgs,
  type SettingsMutArgs,
  type User,
  type UserMutArgs,
} from "../generated";
import {
  Permission,
  Permissions,
  Secp256r1Key,
  type ConfigurationArgs,
  type IPermission,
  type PermissionArgs,
} from "../types";
import {
  getCompressedSettingsAddressFromIndex,
  getUserAccountAddress,
} from "../utils";
import {
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import { convertPubkeyToMemberkey } from "../utils/transaction/internal";

export async function prepareChangeConfigArgs({
  index,
  settingsAddressTreeIndex,
  configActionsArgs,
  cachedAccounts,
  compressed = false,
}: {
  index: number | bigint;
  compressed?: boolean;
  settingsAddressTreeIndex?: number;
  configActionsArgs: ConfigurationArgs[];
  cachedAccounts?: Map<string, any>;
}): Promise<{
  configActions: ConfigAction[];
  index: number | bigint;
  compressed: boolean;
  packedAccounts: PackedAccounts;
  proof: ValidityProofWithContext | null;
  settingsMutArgs: SettingsMutArgs | null;
}> {
  const userAccounts = await prepareUserAccounts(configActionsArgs);

  const packedAccounts = new PackedAccounts();
  let proof: ValidityProofWithContext | null = null;
  let settingsMutArgs: SettingsMutArgs | null = null;
  let userMutArgs: UserMutArgs[] = [];

  if (userAccounts.length || compressed) {
    const proofResult = await prepareProofAndMutArgs({
      packedAccounts,
      userAccounts,
      compressed,
      index,
      settingsAddressTreeIndex,
      cachedAccounts,
    });

    proof = proofResult.proof;
    settingsMutArgs = proofResult.settingsMutArgs ?? null;
    userMutArgs = proofResult.userMutArgs ?? [];
  }

  const configActions = await buildConfigActions({
    configActionsArgs,
    userMutArgs,
    index,
  });

  return {
    configActions,
    index,
    proof,
    settingsMutArgs,
    packedAccounts,
    compressed,
  };
}

async function prepareUserAccounts(configActionsArgs: ConfigurationArgs[]) {
  const result: { address: BN254; type: "User" }[] = [];

  for (const action of configActionsArgs) {
    switch (action.type) {
      case "AddMembers": {
        const results = await Promise.all(
          action.members.map((m) =>
            getUserAccountAddress(m.member, m.userAddressTreeIndex)
          )
        );
        for (const r of results)
          result.push({ address: r.address, type: "User" });
        break;
      }

      case "RemoveMembers": {
        const results = await Promise.all(
          action.members.map((m) =>
            getUserAccountAddress(m.member, m.userAddressTreeIndex)
          )
        );
        for (const r of results)
          result.push({ address: r.address, type: "User" });
        break;
      }

      default:
        break;
    }
  }

  return result;
}

async function prepareProofAndMutArgs({
  packedAccounts,
  userAccounts,
  compressed,
  index,
  settingsAddressTreeIndex,
  cachedAccounts,
}: {
  packedAccounts: PackedAccounts;
  userAccounts: { address: BN254; type: "User" }[];
  compressed: boolean;
  index: number | bigint;
  settingsAddressTreeIndex?: number;
  cachedAccounts?: Map<string, any>;
}) {
  await packedAccounts.addSystemAccounts();

  const addresses: { address: BN254; type: "Settings" | "User" }[] = [];
  if (compressed) {
    const settingsAddr = (
      await getCompressedSettingsAddressFromIndex(
        index,
        settingsAddressTreeIndex
      )
    ).address;
    addresses.push({ address: settingsAddr, type: "Settings" } as any);
  }
  if (userAccounts.length) addresses.push(...userAccounts);

  const hashesWithTree = addresses.length
    ? await getCompressedAccountHashes(addresses, cachedAccounts)
    : [];

  if (!hashesWithTree.length)
    return { proof: null, settingsMutArgs: undefined, userMutArgs: [] };

  const proof = await getValidityProofWithRetry(hashesWithTree, []);

  const settingsHashes = [] as typeof hashesWithTree;
  const userHashes = [] as typeof hashesWithTree;
  for (const h of hashesWithTree) {
    if (h.type === "Settings") settingsHashes.push(h);
    else if (h.type === "User") userHashes.push(h);
  }

  let settingsMutArgs: SettingsMutArgs | undefined;
  let userMutArgs: UserMutArgs[] = [];

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
    const start = compressed ? 1 : 0;
    userMutArgs = getCompressedAccountMutArgs<User>(
      packedAccounts,
      proof.treeInfos.slice(start),
      proof.leafIndices.slice(start),
      proof.rootIndices.slice(start),
      proof.proveByIndices.slice(start),
      userHashes,
      getUserDecoder()
    );
  }

  return { proof, settingsMutArgs, userMutArgs };
}

async function buildConfigActions({
  index,
  configActionsArgs,
  userMutArgs,
}: {
  index: number | bigint;
  configActionsArgs: ConfigurationArgs[];
  userMutArgs: UserMutArgs[];
}): Promise<ConfigAction[]> {
  const configActions: ConfigAction[] = [];

  for (const action of configActionsArgs) {
    switch (action.type) {
      case "AddMembers": {
        const field: AddMemberArgs[] = [];
        for (const m of action.members) {
          const userArgs = await getUserAccountAddress(
            m.member,
            m.userAddressTreeIndex
          ).then((r) => {
            return userMutArgs.find((arg) =>
              equalBytes(
                new Uint8Array(arg.accountMeta.address),
                new Uint8Array(
                  getBase58Encoder().encode(encodeBN254toBase58(r.address))
                )
              )
            );
          });
          if (!userArgs) throw new Error("Unable to find user account");
          field.push(
            convertAddMember({
              permissionArgs: m.permissions,
              userMutArgs: userArgs,
              pubkey: m.member,
            })
          );
        }

        configActions.push({ __kind: action.type, fields: [field] });
        break;
      }

      case "RemoveMembers": {
        const field = await Promise.all(
          action.members.map((m) =>
            getUserAccountAddress(m.member, m.userAddressTreeIndex).then(
              (r) => {
                const found = userMutArgs.find((arg) =>
                  equalBytes(
                    new Uint8Array(arg.accountMeta.address),
                    new Uint8Array(
                      getBase58Encoder().encode(encodeBN254toBase58(r.address))
                    )
                  )
                );
                if (!found) throw new Error("Unable to find user account");
                return convertRemoveMember({
                  pubkey: m.member,
                  userMutArgs: found,
                  index,
                });
              }
            )
          )
        );
        configActions.push({ __kind: action.type, fields: [field] });
        break;
      }

      case "EditPermissions": {
        const field = action.members.map((m) =>
          convertEditMember({
            permissionArgs: m.permissions,
            pubkey: m.member,
          })
        );

        configActions.push({ __kind: action.type, fields: [field] });
        break;
      }

      default:
        configActions.push({ __kind: action.type, fields: [action.threshold] });
    }
  }

  return configActions;
}

function convertEditMember({
  pubkey,
  permissionArgs,
}: {
  pubkey: Address | Secp256r1Key;
  permissionArgs: PermissionArgs;
}): EditMemberArgs {
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    permissions: convertPermissions(permissionArgs),
  };
}

function convertRemoveMember({
  pubkey,
  userMutArgs,
  index,
}: {
  pubkey: Address | Secp256r1Key;
  userMutArgs: UserMutArgs;
  index: number | bigint;
}): RemoveMemberArgs {
  if (userMutArgs.data.role === UserRole.PermanentMember) {
    throw new Error("Permanent Member cannot be removed from the wallet.");
  }
  const isDelegate =
    userMutArgs.data.delegatedTo.__option === "Some"
      ? Number(userMutArgs.data.delegatedTo.value.index.toString()) === index
      : false;
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    userArgs: isDelegate
      ? { __kind: "Mutate", fields: [userMutArgs] }
      : { __kind: "Read", fields: [userMutArgs] },
  };
}

function convertAddMember({
  pubkey,
  permissionArgs,
  userMutArgs,
}: {
  pubkey: Address | Secp256r1Key;
  permissionArgs: PermissionArgs;
  userMutArgs: UserMutArgs;
}): AddMemberArgs {
  if (userMutArgs.data.role === UserRole.PermanentMember) {
    throw new Error("A permanent member can only belong to one wallet.");
  } else if (userMutArgs.data.role === UserRole.TransactionManager) {
    if (permissionArgs.execute || permissionArgs.vote) {
      throw new Error("Transaction Manager can only have initiate permission");
    }
  }
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    permissions: convertPermissions(permissionArgs),
    userReadonlyArgs: userMutArgs,
  };
}

function convertPermissions(p: PermissionArgs): IPermissions {
  const perms: IPermission[] = [];
  if (p.initiate) perms.push(Permission.InitiateTransaction);
  if (p.vote) perms.push(Permission.VoteTransaction);
  if (p.execute) perms.push(Permission.ExecuteTransaction);

  return Permissions.fromPermissions(perms);
}
