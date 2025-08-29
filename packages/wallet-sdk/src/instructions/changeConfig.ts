import { ValidityProofWithContext } from "@lightprotocol/stateless.js";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
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
import { ConfigurationArgs, KeyType, Secp256r1Key } from "../types";
import {
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
}: {
  index: bigint | number;
  configActionsArgs: ConfigurationArgs[];
  payer: TransactionSigner;
  compressed?: boolean;
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
              address: await getCompressedSettingsAddressFromIndex(index),
              type: "Settings" as const,
            },
          ]
        : []),
      ...(await Promise.all(
        removeDelegates.map(async (m) => ({
          address: await getUserAddress(m),
          type: "User" as const,
        }))
      )),
      ...(await Promise.all(
        addDelegates.map(async (m) => ({
          address: await getUserAddress(m),
          type: "User" as const,
        }))
      )),
    ];

    const hashesWithTree = addresses.length
      ? await getCompressedAccountHashes(addresses)
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
          fields: [field.filter(Boolean)],
        });
        break;
      }

      case "EditPermissions": {
        const field = await Promise.all(
          action.members.map(async (m) => {
            const userArgs =
              m.delegateOperation !== DelegateOp.Ignore
                ? await getUserDelegateArgs(m.pubkey, userMutArgs)
                : undefined;
            return convertEditMember({ ...m, userArgs });
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
  const userAddress = await getUserAddress(pubkey);
  const mutArg = userMutArgs.find((arg) =>
    new BN(new Uint8Array(arg.accountMeta.address)).eq(userAddress)
  );
  return mutArg;
}

function convertEditMember(x: {
  pubkey: Address | Secp256r1Key;
  permissions: IPermissions;
  userArgs?: UserMutArgs;
  delegateOperation: DelegateOpArgs;
}): MemberKeyWithEditPermissionsArgs {
  return {
    memberKey: convertPubkeyToMemberkey(x.pubkey),
    permissions: x.permissions,
    userArgs: x.userArgs ? some(x.userArgs) : none(),
    delegateOperation: x.delegateOperation,
  };
}

function convertRemoveMember(x: {
  pubkey: Address | Secp256r1Key;
  userArgs: UserMutArgs;
}): MemberKeyWithRemovePermissionsArgs {
  return {
    memberKey: convertPubkeyToMemberkey(x.pubkey),
    userArgs: x.userArgs,
  };
}

function convertAddMember(x: {
  pubkey: TransactionSigner | Secp256r1Key;
  permissions: IPermissions;
  index: number;
  userArgs: UserMutArgs;
  setAsDelegate: boolean;
}): MemberWithAddPermissionsArgs {
  return {
    member: {
      permissions: x.permissions,
      domainConfig:
        x.pubkey instanceof Secp256r1Key && x.pubkey.domainConfig
          ? x.pubkey.domainConfig
          : SYSTEM_PROGRAM_ADDRESS,
      pubkey: convertPubkeyToMemberkey(
        x.pubkey instanceof Secp256r1Key ? x.pubkey : x.pubkey.address
      ),
    },
    verifyArgs:
      x.pubkey instanceof Secp256r1Key && x.pubkey.verifyArgs && x.index !== -1
        ? some({
            clientDataJson: x.pubkey.verifyArgs.clientDataJson,
            slotNumber: x.pubkey.verifyArgs.slotNumber,
            index: x.index,
          })
        : none(),
    userArgs: x.userArgs,
    setAsDelegate: x.setAsDelegate,
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
