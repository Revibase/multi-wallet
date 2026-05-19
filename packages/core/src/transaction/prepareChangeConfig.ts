import { AccountRole, type Address } from "gill";
import {
  type AddMemberArgs,
  type ConfigAction,
  type EditMemberArgs,
  type IPermissions,
  type RemoveMemberArgs,
} from "../generated";
import {
  Permission,
  Permissions,
  Secp256r1Key,
  type ConfigurationArgs,
  type IPermission,
  type PermissionArgs,
} from "../types";
import { getUserAddress } from "../utils";
import { convertPubkeyToMemberkey } from "../utils/transaction/internal";
import { PackedAccounts } from "../utils/transaction/packedAccounts";

export async function prepareChangeConfigArgs({
  settings,
  configActionsArgs,
}: {
  settings: Address;
  configActionsArgs: ConfigurationArgs[];
}): Promise<{
  configActions: ConfigAction[];
  settings: Address;
  packedAccounts: PackedAccounts;
}> {
  const packedAccounts = new PackedAccounts();

  const configActions = await buildConfigActions({
    configActionsArgs,
    packedAccounts,
  });

  return {
    configActions,
    settings,
    packedAccounts,
  };
}

async function buildConfigActions({
  configActionsArgs,
  packedAccounts,
}: {
  configActionsArgs: ConfigurationArgs[];
  packedAccounts: PackedAccounts;
}): Promise<ConfigAction[]> {
  const configActions: ConfigAction[] = [];

  for (const action of configActionsArgs) {
    switch (action.type) {
      case "AddMembers": {
        const field: AddMemberArgs[] = [];
        for (const m of action.members) {
          packedAccounts.addPreAccounts([
            {
              address: await getUserAddress(m.member),
              role: AccountRole.WRITABLE,
            },
          ]);
          field.push(
            convertAddMember({
              permissionArgs: m.permissions,
              pubkey: m.member,
            }),
          );
        }

        configActions.push({ __kind: action.type, fields: [field] });
        break;
      }

      case "RemoveMembers": {
        const field = await Promise.all(
          action.members.map(async (m) => {
            packedAccounts.addPreAccounts([
              {
                address: await getUserAddress(m.member),
                role: AccountRole.WRITABLE,
              },
            ]);
            return convertRemoveMember({
              pubkey: m.member,
            });
          }),
        );
        configActions.push({ __kind: action.type, fields: [field] });
        break;
      }

      case "EditPermissions": {
        const field = action.members.map((m) =>
          convertEditMember({
            permissionArgs: m.permissions,
            pubkey: m.member,
          }),
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
}: {
  pubkey: Address | Secp256r1Key;
}): RemoveMemberArgs {
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
  };
}

function convertAddMember({
  pubkey,
  permissionArgs,
}: {
  pubkey: Address | Secp256r1Key;
  permissionArgs: PermissionArgs;
}): AddMemberArgs {
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    permissions: convertPermissions(permissionArgs),
  };
}

function convertPermissions(p: PermissionArgs): IPermissions {
  const perms: IPermission[] = [];
  if (p.initiate) perms.push(Permission.InitiateTransaction);
  if (p.vote) perms.push(Permission.VoteTransaction);
  if (p.execute) perms.push(Permission.ExecuteTransaction);

  return Permissions.fromPermissions(perms);
}
