import type { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import BN from "bn.js";
import { AccountRole, type Address, type TransactionSigner } from "gill";
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
  type Secp256r1VerifyArgsWithDomainAddressArgs,
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
  getDeduplicatedSigners,
} from "../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

export async function changeConfig({
  index,
  settingsAddressTreeIndex,
  configActionsArgs,
  signers,
  payer,
  compressed = false,
  cachedAccounts,
}: {
  index: number | bigint;
  settingsAddressTreeIndex?: number;
  configActionsArgs: ConfigurationArgs[];
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  payer: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  // 1) Gather all user accounts
  const userAccounts = await prepareUserAccounts(configActionsArgs);

  // 2) Prepare compressed proof + account mutation args (if needed)
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
  // 3) Prepare signers
  const dedupSigners = getDeduplicatedSigners(signers);
  const transactionSigners = dedupSigners.filter(
    (x) => !(x instanceof SignedSecp256r1Key)
  ) as TransactionSigner[];
  packedAccounts.addPreAccounts(
    transactionSigners.map((x) => ({
      address: x.address,
      role: AccountRole.READONLY_SIGNER,
      signer: x,
    }))
  );
  const secp256r1Signers = dedupSigners.filter(
    (x) => x instanceof SignedSecp256r1Key
  );
  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];
  const secp256r1VerifyInput = [];
  for (const x of secp256r1Signers) {
    const index = secp256r1VerifyInput.length;
    const { domainConfig, verifyArgs, signature, publicKey, message } =
      extractSecp256r1VerificationArgs(x, index);
    if (message && signature && publicKey) {
      secp256r1VerifyInput.push({ message, signature, publicKey });
    }
    if (domainConfig) {
      packedAccounts.addPreAccounts([
        { address: domainConfig, role: AccountRole.READONLY },
      ]);
      if (verifyArgs?.__option === "Some") {
        secp256r1VerifyArgs.push({
          domainConfigKey: domainConfig,
          verifyArgs: verifyArgs.value,
        });
      }
    }
  }

  // 4) Build the config actions
  const configActions = await buildConfigActions({
    configActionsArgs,
    userMutArgs,
    index,
  });

  // 5) Assemble final instructions
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);
  const instructions = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }
  instructions.push(
    compressed
      ? getChangeConfigCompressedInstruction({
          configActions,
          payer,
          compressedProofArgs,
          settingsMut: settingsMutArgs!,
          remainingAccounts,
          secp256r1VerifyArgs,
        })
      : await getChangeConfigInstructionAsync({
          settingsIndex: index,
          configActions,
          payer,
          compressedProofArgs,
          remainingAccounts,
          secp256r1VerifyArgs,
        })
  );

  return instructions;
}

async function prepareUserAccounts(configActionsArgs: ConfigurationArgs[]) {
  const result: { address: BN; type: "User" }[] = [];

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
  userAccounts: { address: BN; type: "User" }[];
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
              new BN(new Uint8Array(arg.accountMeta.address)).eq(r.address)
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
                  new BN(new Uint8Array(arg.accountMeta.address)).eq(r.address)
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
