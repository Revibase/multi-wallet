import { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import {
  AccountRole,
  AccountSignerMeta,
  Address,
  createNoopSigner,
  getAddressEncoder,
  none,
  some,
  TransactionSigner,
} from "@solana/kit";
import BN from "bn.js";
import {
  CompressedSettings,
  ConfigAction,
  DelegateOp,
  DelegateOpArgs,
  getChangeConfigCompressedInstruction,
  getChangeConfigInstruction,
  getCompressedSettingsDecoder,
  getUserDecoder,
  IPermissions,
  MemberKey,
  MemberKeyWithEditPermissionsArgs,
  MemberKeyWithRemovePermissionsArgs,
  MemberWithAddPermissionsArgs,
  SettingsMutArgs,
  User,
  UserMutArgs,
} from "../generated";
import {
  ConfigurationArgs,
  KeyType,
  PermanentMemberPermission,
  Permissions,
  Secp256r1Key,
} from "../types";
import {
  convertMemberKeyToString,
  fetchSettingsData,
  getCompressedSettingsAddressFromIndex,
  getLightProtocolRpc,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
  getUserAddress,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import { extractSecp256r1VerificationArgs } from "../utils/transactionMessage/internal";
import { Secp256r1VerifyInput } from "./secp256r1Verify";

export async function changeConfig({
  index,
  configActionsArgs,
  payer,
  compressed = false,
  cachedCompressedAccounts,
}: {
  index: bigint | number;
  configActionsArgs: ConfigurationArgs[];
  payer: TransactionSigner;
  compressed?: boolean;
  cachedCompressedAccounts?: Map<string, any>;
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
          m.pubkey instanceof Secp256r1Key ? m.pubkey : m.pubkey.address
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
  let userMutArgs: UserMutArgs[] = [];

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
        address: getUserAddress(m),
        type: "User" as const,
      })),
      ...addDelegates.map((m) => ({
        address: getUserAddress(m),
        type: "User" as const,
      })),
    ];

    const hashesWithTree = addresses.length
      ? await getCompressedAccountHashes(addresses, cachedCompressedAccounts)
      : [];

    if (hashesWithTree.length) {
      proof = await getLightProtocolRpc().getValidityProofV0(
        hashesWithTree,
        []
      );

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

            const userArgs = await getUserDelegateArgs(m.pubkey, userMutArgs);
            if (userArgs) {
              field.push(convertAddMember({ ...m, index, userArgs }));
            }
          } else {
            packedAccounts.addPreAccounts([
              {
                address: m.pubkey.address,
                role: AccountRole.READONLY_SIGNER,
                signer: m.pubkey,
              } as AccountSignerMeta,
            ]);

            const userArgs = await getUserDelegateArgs(
              m.pubkey.address,
              userMutArgs
            );
            if (userArgs) {
              field.push(convertAddMember({ ...m, index: -1, userArgs }));
            }
          }
        }
        configActions.push({ __kind: action.type, fields: [field] });
        break;
      }

      case "RemoveMembers": {
        const field = await Promise.all(
          action.members.map(async (m) => {
            const userArgs = await getUserDelegateArgs(m.pubkey, userMutArgs);
            if (!userArgs) throw new Error("User account not found");
            return convertRemoveMember({ ...m, userArgs });
          })
        );
        configActions.push({
          __kind: action.type,
          fields: [field],
        });
        break;
      }

      case "EditPermissions": {
        const settingsData = await fetchSettingsData(
          index,
          cachedCompressedAccounts
        );
        const permanentMember = settingsData.members.find((x) =>
          Permissions.has(x.permissions, PermanentMemberPermission)
        );
        const field = await Promise.all(
          action.members.map(async (m) => {
            const userArgs =
              m.delegateOperation !== DelegateOp.Ignore
                ? await getUserDelegateArgs(m.pubkey, userMutArgs)
                : undefined;
            const isPermanentMember =
              !!permanentMember?.pubkey &&
              convertMemberKeyToString(permanentMember.pubkey) ===
                m.pubkey.toString();
            if (isPermanentMember) {
              if (userArgs || m.delegateOperation !== DelegateOp.Ignore) {
                throw new Error(
                  "Delegation cannot be modified for a permanent member. Permanent members must always remain delegates."
                );
              }
            }
            const permissions = isPermanentMember
              ? { mask: m.permissions.mask | PermanentMemberPermission }
              : m.permissions;
            return convertEditMember({ ...m, permissions, userArgs });
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

async function getUserDelegateArgs(
  pubkey: Address | Secp256r1Key,
  userMutArgs: UserMutArgs[]
): Promise<UserMutArgs | undefined> {
  const userAddress = getUserAddress(pubkey);
  const mutArg = userMutArgs.find((arg) =>
    new BN(new Uint8Array(arg.accountMeta.address)).eq(userAddress)
  );
  return mutArg;
}

function convertEditMember({
  pubkey,
  permissions,
  userArgs,
  delegateOperation,
}: {
  pubkey: Address | Secp256r1Key;
  permissions: IPermissions;
  userArgs?: UserMutArgs;
  delegateOperation: DelegateOpArgs;
}): MemberKeyWithEditPermissionsArgs {
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    permissions,
    userArgs: userArgs ? some(userArgs) : none(),
    delegateOperation,
  };
}

function convertRemoveMember({
  pubkey,
  userArgs,
}: {
  pubkey: Address | Secp256r1Key;
  userArgs: UserMutArgs;
}): MemberKeyWithRemovePermissionsArgs {
  return {
    memberKey: convertPubkeyToMemberkey(pubkey),
    userArgs,
  };
}

function convertAddMember({
  pubkey,
  permissions,
  index,
  userArgs,
  setAsDelegate,
}: {
  pubkey: TransactionSigner | Secp256r1Key;
  permissions: IPermissions;
  index: number;
  userArgs: UserMutArgs;
  setAsDelegate: boolean;
}): MemberWithAddPermissionsArgs {
  if (userArgs.data.isPermanentMember) {
    if (!setAsDelegate) {
      throw new Error(
        "Permanent members must also be delegates. Please set `setAsDelegate = true`."
      );
    }
    if (userArgs.data.settingsIndex.__option === "Some") {
      throw new Error(
        "This user is already registered as a permanent member in another wallet. A permanent member can only belong to one wallet."
      );
    }
    permissions.mask |= PermanentMemberPermission;
  }
  return {
    member: {
      permissions,
      pubkey: convertPubkeyToMemberkey(
        pubkey instanceof Secp256r1Key ? pubkey : pubkey.address
      ),
    },
    verifyArgs:
      pubkey instanceof Secp256r1Key && pubkey.verifyArgs && index !== -1
        ? some({
            clientDataJson: pubkey.verifyArgs.clientDataJson,
            slotNumber: pubkey.verifyArgs.slotNumber,
            index: index,
          })
        : none(),
    userArgs,
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
