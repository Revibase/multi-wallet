import type { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import BN from "bn.js";
import {
  AccountRole,
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
  type EditMemberArgs,
  getChangeConfigCompressedInstruction,
  getChangeConfigInstructionAsync,
  getCompressedSettingsDecoder,
  getUserDecoder,
  type IPermissions,
  type RemoveMemberArgs,
  type SettingsMutArgs,
  type User,
  type UserMutArgs,
  UserRole,
} from "../generated";
import {
  type ConfigurationArgs,
  type IPermission,
  Permission,
  type PermissionArgs,
  Permissions,
  Secp256r1Key,
  SignedSecp256r1Key,
} from "../types";
import {
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
  index,
  settingsAddressTreeIndex,
  configActionsArgs,
  payer,
  compressed = false,
  cachedAccounts,
}: {
  index: number | bigint;
  settingsAddressTreeIndex?: number;
  configActionsArgs: ConfigurationArgs[];
  payer: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  // 1) Stage delegate address gathering (Add / Remove lists)
  const { addDelegates, removeDelegates } =
    await prepareDelegateLists(configActionsArgs);

  // 2) Prepare compressed proof + account mutation args (if needed)
  const packedAccounts = new PackedAccounts();
  let proof: ValidityProofWithContext | null = null;
  let settingsMutArgs: SettingsMutArgs | null = null;
  let userMutArgs: UserMutArgs[] = [];

  if (addDelegates.length || removeDelegates.length || compressed) {
    const proofResult = await prepareProofAndMutArgs({
      packedAccounts,
      addDelegates,
      removeDelegates,
      compressed,
      index,
      settingsAddressTreeIndex,
      cachedAccounts,
    });

    proof = proofResult.proof;
    settingsMutArgs = proofResult.settingsMutArgs ?? null;
    userMutArgs = proofResult.userMutArgs ?? [];
  }

  // 3) Build the config actions and collect secp verify inputs
  const { configActions, secp256r1VerifyInput } = await buildConfigActions({
    configActionsArgs,
    packedAccounts,
    userMutArgs,
  });

  // 4) Assemble final instructions
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  const instructions = compressed
    ? [
        getChangeConfigCompressedInstruction({
          configActions,
          payer,
          authority: createNoopSigner(await getWalletAddressFromIndex(index)),
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

async function prepareDelegateLists(configActionsArgs: ConfigurationArgs[]) {
  const addDelegates: { address: BN; type: "User" }[] = [];
  const removeDelegates: { address: BN; type: "User" }[] = [];

  for (const action of configActionsArgs) {
    switch (action.type) {
      case "AddMembers": {
        const results = await Promise.all(
          action.members.map((m) =>
            getUserAccountAddress(m.member, m.userAddressTreeIndex)
          )
        );
        for (const r of results)
          addDelegates.push({ address: r.address, type: "User" });
        break;
      }

      case "RemoveMembers": {
        const results = await Promise.all(
          action.members.map((m) =>
            getUserAccountAddress(m.member, m.userAddressTreeIndex)
          )
        );
        for (const r of results)
          removeDelegates.push({ address: r.address, type: "User" });
        break;
      }

      default:
        break;
    }
  }

  return { addDelegates, removeDelegates };
}

async function prepareProofAndMutArgs({
  packedAccounts,
  addDelegates,
  removeDelegates,
  compressed,
  index,
  settingsAddressTreeIndex,
  cachedAccounts,
}: {
  packedAccounts: PackedAccounts;
  addDelegates: { address: BN; type: "User" }[];
  removeDelegates: { address: BN; type: "User" }[];
  compressed: boolean;
  index: number | bigint;
  settingsAddressTreeIndex?: number;
  cachedAccounts?: Map<string, any>;
}) {
  await packedAccounts.addSystemAccounts();

  const addresses: { address: BN; type: "Settings" | "User" }[] = [];
  if (compressed) {
    const settingsAddr = (
      await getCompressedSettingsAddressFromIndex(
        index,
        settingsAddressTreeIndex
      )
    ).address;
    addresses.push({ address: settingsAddr, type: "Settings" } as any);
  }
  if (removeDelegates.length) addresses.push(...removeDelegates);
  if (addDelegates.length) addresses.push(...addDelegates);

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
  configActionsArgs,
  packedAccounts,
  userMutArgs,
}: {
  configActionsArgs: ConfigurationArgs[];
  packedAccounts: PackedAccounts;
  userMutArgs: UserMutArgs[];
}): Promise<{
  configActions: ConfigAction[];
  secp256r1VerifyInput: Secp256r1VerifyInput;
}> {
  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const configActions: ConfigAction[] = [];

  for (const action of configActionsArgs) {
    switch (action.type) {
      case "AddMembers": {
        const field: AddMemberArgs[] = [];
        for (const m of action.members) {
          if (m.member instanceof SignedSecp256r1Key) {
            const index = secp256r1VerifyInput.length;
            const { message, signature, publicKey, domainConfig } =
              extractSecp256r1VerificationArgs(m.member, index);

            if (message && signature && publicKey) {
              secp256r1VerifyInput.push({ message, signature, publicKey });
            }

            if (domainConfig) {
              packedAccounts.addPreAccounts([
                { address: domainConfig, role: AccountRole.READONLY },
              ]);
            }

            const userArgs = await getUserAccountAddress(
              m.member,
              m.userAddressTreeIndex
            ).then((r) => {
              return userMutArgs.find((arg) =>
                new BN(new Uint8Array(arg.accountMeta.address)).eq(r.address)
              );
            });
            if (!userArgs) throw new Error("Unable to find user account");
            field.push(
              convertAddMember({
                permissionArgs: m.permissions,
                index,
                userMutArgs: userArgs,
                pubkey: m.member,
              })
            );
          } else {
            const userArgs = await getUserAccountAddress(
              m.member,
              m.userAddressTreeIndex
            ).then((r) =>
              userMutArgs.find((arg) =>
                new BN(new Uint8Array(arg.accountMeta.address)).eq(r.address)
              )
            );
            if (!userArgs) throw new Error("Unable to find user account");
            field.push(
              convertAddMember({
                permissionArgs: m.permissions,
                index: -1,
                userMutArgs: userArgs,
                pubkey: m.member,
              })
            );
          }
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
                  new BN(new Uint8Array(arg.accountMeta.address)).eq(r.address)
                );
                if (!found) throw new Error("Unable to find user account");
                return convertRemoveMember({
                  pubkey: m.member,
                  userMutArgs: found,
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

  return { configActions, secp256r1VerifyInput };
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
}: {
  pubkey: Address | Secp256r1Key;
  userMutArgs: UserMutArgs;
}): RemoveMemberArgs {
  if (userMutArgs.data.role === UserRole.PermanentMember) {
    throw new Error("Permanent Member cannot be removed from the wallet.");
  }
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    userMutArgs,
  };
}

function convertAddMember({
  pubkey,
  permissionArgs,
  index,
  userMutArgs,
}: {
  pubkey: TransactionSigner | SignedSecp256r1Key | Address;
  permissionArgs: PermissionArgs;
  index: number;
  userMutArgs: UserMutArgs;
}): AddMemberArgs {
  if (userMutArgs.data.role === UserRole.PermanentMember) {
    if (userMutArgs.data.delegatedTo.__option === "Some") {
      throw new Error(
        "This user is already registered as a permanent member in another wallet. A permanent member can only belong to one wallet."
      );
    }
  } else if (userMutArgs.data.role === UserRole.TransactionManager) {
    if (permissionArgs.execute || permissionArgs.vote) {
      throw new Error("Transaction Manager can only have initiate permission");
    }
  }
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    permissions: convertPermissions(permissionArgs),
    verifyArgs:
      pubkey instanceof SignedSecp256r1Key && pubkey.verifyArgs && index !== -1
        ? some({
            truncatedClientDataJson: pubkey.verifyArgs.truncatedClientDataJson,
            slotNumber: pubkey.verifyArgs.slotNumber,
            signedMessageIndex: index,
            originIndex: pubkey.originIndex,
            crossOrigin: pubkey.crossOrigin,
            clientAndDeviceHash: pubkey.clientAndDeviceHash,
          })
        : none(),
    userMutArgs,
  };
}

function convertPermissions(p: PermissionArgs): IPermissions {
  const perms: IPermission[] = [];
  if (p.initiate) perms.push(Permission.InitiateTransaction);
  if (p.vote) perms.push(Permission.VoteTransaction);
  if (p.execute) perms.push(Permission.ExecuteTransaction);

  return Permissions.fromPermissions(perms);
}
