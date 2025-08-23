import {
  BN254,
  PackedStateTreeInfo,
  ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import {
  AccountRole,
  Address,
  createNoopSigner,
  TransactionSigner,
} from "@solana/kit";
import BN from "bn.js";
import {
  fetchSettingsData,
  getCompressedSettingsAddressFromIndex,
  getUserAddress,
} from "../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import {
  CompressedSettings,
  getChangeConfigCompressedInstruction,
  getChangeConfigInstruction,
  getCompressedSettingsDecoder,
  getUserDecoder,
  IPermissions,
  User,
  UserMutArgs,
} from "../generated";
import {
  ConfigActionWrapper,
  ConfigActionWrapperWithDelegateArgs,
  Permission,
  Permissions,
  Secp256r1Key,
} from "../types";
import {
  convertMemberKeyToString,
  getLightProtocolRpc,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
} from "../utils";
import {
  convertConfigActionWrapper,
  convertMemberkey,
  extractSecp256r1VerificationArgs,
} from "../utils/internal";
import { Secp256r1VerifyInput } from "./secp256r1Verify";

export async function changeConfig({
  index,
  configActions,
  payer,
  compressed = false,
}: {
  index: bigint | number;
  configActions: ConfigActionWrapper[];
  payer: TransactionSigner;
  compressed?: boolean;
}) {
  const [settingsData, settings] = await Promise.all([
    fetchSettingsData(index),
    getSettingsFromIndex(index),
  ]);
  const multiWallet = await getMultiWalletFromSettings(settings);
  const packedAccounts = new PackedAccounts();
  const hashesWithTree = [];
  let proof: ValidityProofWithContext | null = null;

  const addDelegates = configActions.flatMap((action) => {
    if (action.type === "AddMembers")
      return action.members.filter((m) => isDelegate(m.permissions));
    if (action.type === "EditPermissions") {
      return action.members.filter((m) => {
        const existing = settingsData.members.find(
          (x) => convertMemberKeyToString(x.pubkey) === m.pubkey.toString()
        );
        return (
          existing &&
          isDelegate(m.permissions) &&
          !isDelegate(existing.permissions)
        );
      });
    }
    return [];
  });

  const removeDelegates = configActions.flatMap((action) => {
    if (action.type === "RemoveMembers") {
      const removing = new Set(action.members.map((m) => m.pubkey.toString()));
      return settingsData.members.filter(
        (m) =>
          isDelegate(m.permissions) &&
          removing.has(convertMemberKeyToString(m.pubkey))
      );
    }
    if (action.type === "EditPermissions") {
      return settingsData.members.filter((m) => {
        const edited = action.members.find(
          (am) => am.pubkey.toString() === convertMemberKeyToString(m.pubkey)
        );
        return (
          edited && !isDelegate(edited.permissions) && isDelegate(m.permissions)
        );
      });
    }
    return [];
  });

  if (addDelegates.length || removeDelegates.length || compressed) {
    await packedAccounts.addSystemAccounts();
    const addresses: { pubkey: BN254; type: "Settings" | "User" }[] = [];

    if (compressed) {
      addresses.push({
        pubkey: await getCompressedSettingsAddressFromIndex(index),
        type: "Settings",
      });
    }

    for (const m of removeDelegates) {
      addresses.push({
        pubkey: await getCachedUserAddress(convertMemberkey(m.pubkey)),
        type: "User",
      });
    }

    for (const m of addDelegates) {
      addresses.push({
        pubkey: await getCachedUserAddress(m.pubkey),
        type: "User",
      });
    }

    if (addresses.length) {
      hashesWithTree.push(...(await getCompressedAccountHashes(addresses)));
    }
    proof = await getLightProtocolRpc().getValidityProofV0(hashesWithTree, []);
  }
  const settingsEndIndex = compressed ? 1 : 0;
  const hashesWithTreeEndIndex = hashesWithTree.length;

  const settingsMutArgs =
    settingsEndIndex > 0 && proof
      ? getCompressedAccountMutArgs<CompressedSettings>(
          packedAccounts,
          proof.treeInfos.slice(0, settingsEndIndex),
          proof.leafIndices.slice(0, settingsEndIndex),
          proof.rootIndices.slice(0, settingsEndIndex),
          proof.proveByIndices.slice(0, settingsEndIndex),
          hashesWithTree.filter((x) => x.type === "Settings"),
          getCompressedSettingsDecoder()
        )[0]
      : null;

  const userMutArgs =
    settingsEndIndex < hashesWithTreeEndIndex && proof
      ? getCompressedAccountMutArgs<User>(
          packedAccounts,
          proof.treeInfos.slice(settingsEndIndex, hashesWithTreeEndIndex),
          proof.leafIndices.slice(settingsEndIndex, hashesWithTreeEndIndex),
          proof.rootIndices.slice(settingsEndIndex, hashesWithTreeEndIndex),
          proof.proveByIndices.slice(settingsEndIndex, hashesWithTreeEndIndex),
          hashesWithTree.filter((x) => x.type === "User"),
          getUserDecoder()
        )
      : [];

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  let instructionsSysvar;
  let slotHashSysvar;
  const configActionsWithDelegate: ConfigActionWrapperWithDelegateArgs[] = [];
  for (const action of configActions) {
    if (action.type === "AddMembers") {
      const enriched = [];
      for (const m of action.members) {
        let index = -1;
        if (m.pubkey instanceof Secp256r1Key) {
          index = secp256r1VerifyInput.length;

          const {
            message,
            signature,
            publicKey,
            domainConfig,
            instructionsSysvar: ixSysvar,
            slotHashSysvar: slotSysvar,
          } = extractSecp256r1VerificationArgs(m.pubkey, index);
          instructionsSysvar = ixSysvar;
          slotHashSysvar = slotSysvar;
          if (message && signature && publicKey) {
            secp256r1VerifyInput.push({ message, signature, publicKey });
          }

          if (domainConfig) {
            packedAccounts.addPreAccounts([
              { address: domainConfig, role: AccountRole.READONLY },
            ]);
          }
        }

        const userDelegateCreationArgs = await getUserDelegateCreateArgs(
          m,
          userMutArgs
        );

        enriched.push({ ...m, userDelegateCreationArgs, index });
      }

      configActionsWithDelegate.push({ ...action, members: enriched });
    } else if (action.type === "RemoveMembers") {
      const enriched = await Promise.all(
        action.members.map(async (m) => {
          const userDelegateCloseArgs = await getUserDelegateRemoveArgs(
            m.pubkey,
            userMutArgs
          );
          return { ...m, userDelegateCloseArgs };
        })
      );
      configActionsWithDelegate.push({ ...action, members: enriched });
    } else if (action.type === "EditPermissions") {
      const enriched = await Promise.all(
        action.members.map(async (m) => {
          const userDelegateCreationArgs = await getUserDelegateCreateArgs(
            m,
            userMutArgs
          );
          const userDelegateCloseArgs = await getUserDelegateRemoveArgs(
            m.pubkey,
            userMutArgs
          );
          return {
            ...m,
            userDelegateCreationArgs,
            userDelegateCloseArgs,
          };
        })
      );
      configActionsWithDelegate.push({ ...action, members: enriched });
    } else {
      configActionsWithDelegate.push(action);
    }
  }
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);
  const configurations = convertConfigActionWrapper(configActionsWithDelegate);
  const instructions = [];
  if (compressed) {
    if (!settingsMutArgs) {
      throw new Error("Proof args is missing.");
    }
    instructions.push(
      getChangeConfigCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        configActions: configurations,
        payer,
        authority: createNoopSigner(multiWallet),
        compressedProofArgs,
        settingsMut: settingsMutArgs,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getChangeConfigInstruction({
        instructionsSysvar,
        slotHashSysvar,
        configActions: configurations,
        settings,
        payer,
        authority: createNoopSigner(multiWallet),
        compressedProofArgs,
        remainingAccounts,
      })
    );
  }

  return { instructions, secp256r1VerifyInput };
}

const delegateAddressCache = new Map<string, BN>();
async function getCachedUserAddress(
  pubkey: Address | Secp256r1Key
): Promise<BN> {
  const key = pubkey.toString();
  if (!delegateAddressCache.has(key)) {
    delegateAddressCache.set(key, await getUserAddress(pubkey));
  }
  return delegateAddressCache.get(key)!;
}

const isDelegate = (permissions: IPermissions) =>
  Permissions.has(permissions, Permission.IsDelegate);

async function getUserDelegateCreateArgs(
  m: {
    pubkey: Address | Secp256r1Key;
    permissions: IPermissions;
  },
  userMutArgs: {
    data: User;
    accountMeta: {
      treeInfo: PackedStateTreeInfo;
      address: Uint8Array<ArrayBuffer>;
      outputStateTreeIndex: number;
    };
  }[]
): Promise<UserMutArgs | undefined> {
  const userAddress = await getCachedUserAddress(m.pubkey);

  const mutArg = userMutArgs.find((arg) =>
    new BN(arg.accountMeta.address).eq(userAddress)
  );
  return mutArg;
}

async function getUserDelegateRemoveArgs(
  pubkey: Secp256r1Key | Address,
  userMutArgs: {
    data: User;
    accountMeta: {
      treeInfo: PackedStateTreeInfo;
      address: Uint8Array<ArrayBuffer>;
      outputStateTreeIndex: number;
    };
  }[]
) {
  const delegateAddress = await getCachedUserAddress(pubkey);
  return userMutArgs.find((arg) =>
    new BN(arg.accountMeta.address).eq(delegateAddress)
  );
}
