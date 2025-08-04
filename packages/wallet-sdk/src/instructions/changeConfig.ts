import {
  AddressWithTree,
  BN254,
  PackedAddressTreeInfo,
  PackedStateTreeInfo,
  ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import { Address, createNoopSigner, TransactionSigner } from "@solana/kit";
import BN from "bn.js";
import {
  fetchSettingsData,
  getCompressedSettingsAddressFromIndex,
  getDelegateAddress,
} from "../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewAddressesParams,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import {
  CompressedSettings,
  Delegate,
  DelegateCreateOrMutateArgs,
  getChangeConfigCompressedInstruction,
  getChangeConfigInstruction,
  getCompressedSettingsDecoder,
  getDelegateDecoder,
  IPermissions,
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
  convertMemberkeyToPubKey,
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
  const newAddresses: (AddressWithTree & { type: "Delegate" | "Settings" })[] =
    [];
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
    const addresses: { pubkey: BN254; type: "Settings" | "Delegate" }[] = [];

    if (compressed) {
      addresses.push({
        pubkey: await getCompressedSettingsAddressFromIndex(index),
        type: "Settings",
      });
    }

    for (const m of removeDelegates) {
      addresses.push({
        pubkey: await getCachedDelegateAddress(
          convertMemberkeyToPubKey(m.pubkey)
        ),
        type: "Delegate",
      });
    }

    for (const m of addDelegates) {
      const delegateAddress = await getCachedDelegateAddress(m.pubkey);
      const result =
        await getLightProtocolRpc().getCompressedAccount(delegateAddress);
      if (!result?.data?.data) {
        newAddresses.push(
          ...getNewAddressesParams([
            { pubkey: delegateAddress, type: "Delegate" },
          ])
        );
      } else {
        const { index } = getDelegateDecoder().decode(result.data.data);
        if (index.__option === "None") {
          addresses.push({ pubkey: delegateAddress, type: "Delegate" });
        } else {
          throw new Error("Delegate already exist.");
        }
      }
    }

    if (addresses.length) {
      hashesWithTree.push(...(await getCompressedAccountHashes(addresses)));
    }
    proof = await getLightProtocolRpc().getValidityProofV0(
      hashesWithTree,
      newAddresses
    );
  }
  const settingsEndIndex = compressed ? 1 : 0;
  const hashesWithTreeEndIndex = hashesWithTree.length;

  const settingsMutArgs =
    settingsEndIndex > 0 && proof
      ? (
          await getCompressedAccountMutArgs<CompressedSettings>(
            packedAccounts,
            proof.treeInfos.slice(0, settingsEndIndex),
            proof.leafIndices.slice(0, settingsEndIndex),
            proof.rootIndices.slice(0, settingsEndIndex),
            proof.proveByIndices.slice(0, settingsEndIndex),
            hashesWithTree.filter((x) => x.type === "Settings"),
            getCompressedSettingsDecoder()
          )
        )[0]
      : null;

  const delegateMutArgs =
    settingsEndIndex < hashesWithTreeEndIndex && proof
      ? await getCompressedAccountMutArgs<Delegate>(
          packedAccounts,
          proof.treeInfos.slice(settingsEndIndex, hashesWithTreeEndIndex),
          proof.leafIndices.slice(settingsEndIndex, hashesWithTreeEndIndex),
          proof.rootIndices.slice(settingsEndIndex, hashesWithTreeEndIndex),
          proof.proveByIndices.slice(settingsEndIndex, hashesWithTreeEndIndex),
          hashesWithTree.filter((x) => x.type === "Delegate"),
          getDelegateDecoder()
        )
      : [];

  const delegateCreateArgs =
    newAddresses.length && proof
      ? await getCompressedAccountInitArgs(
          packedAccounts,
          proof.treeInfos.slice(hashesWithTreeEndIndex),
          proof.roots.slice(hashesWithTreeEndIndex),
          proof.rootIndices.slice(hashesWithTreeEndIndex),
          newAddresses,
          hashesWithTreeEndIndex > 0
            ? proof.treeInfos.slice(0, hashesWithTreeEndIndex)
            : undefined
        )
      : [];

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const configActionsWithDelegate: ConfigActionWrapperWithDelegateArgs[] = [];
  for (const action of configActions) {
    if (action.type === "AddMembers") {
      const enriched = [];
      for (const m of action.members) {
        let index = -1;
        if (m.pubkey instanceof Secp256r1Key) {
          index = secp256r1VerifyInput.length;

          const { message, signature, publicKey, domainConfig } =
            await extractSecp256r1VerificationArgs(m.pubkey, index);

          if (message && signature && publicKey) {
            secp256r1VerifyInput.push({ message, signature, publicKey });
          }

          if (domainConfig) {
            packedAccounts.addPreAccounts([{ address: domainConfig, role: 0 }]);
          }
        }

        const delegateArgs = await getDelegateCreateOrMutArgs(
          m,
          delegateCreateArgs,
          delegateMutArgs
        );

        enriched.push({ ...m, delegateArgs, index });
      }

      configActionsWithDelegate.push({ ...action, members: enriched });
    } else if (action.type === "RemoveMembers") {
      const enriched = await Promise.all(
        action.members.map(async (m) => {
          const delegateArgs = await getDelegateRemoveArgs(
            m.pubkey,
            delegateMutArgs
          );
          return { ...m, delegateArgs };
        })
      );
      configActionsWithDelegate.push({ ...action, members: enriched });
    } else if (action.type === "EditPermissions") {
      const enriched = await Promise.all(
        action.members.map(async (m) => {
          const delegateCreateOrMutArgs = await getDelegateCreateOrMutArgs(
            m,
            delegateCreateArgs,
            delegateMutArgs
          );
          const delegateCloseArgs = await getDelegateRemoveArgs(
            m.pubkey,
            delegateMutArgs
          );
          return {
            ...m,
            delegateCreateArgs: delegateCreateOrMutArgs,
            delegateCloseArgs,
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
async function getCachedDelegateAddress(
  pubkey: Address | Secp256r1Key
): Promise<BN> {
  const key = pubkey.toString();
  if (!delegateAddressCache.has(key)) {
    delegateAddressCache.set(key, await getDelegateAddress(pubkey));
  }
  return delegateAddressCache.get(key)!;
}

const isDelegate = (permissions: IPermissions) =>
  Permissions.has(permissions, Permission.IsDelegate);

async function getDelegateCreateOrMutArgs(
  m: {
    pubkey: Address | Secp256r1Key;
    permissions: IPermissions;
  },
  delegateCreateArgs: {
    addressTreeInfo: PackedAddressTreeInfo;
    outputStateTreeIndex: number;
    address: BN;
    type: "Settings" | "Delegate";
  }[],
  delegateMutArgs: {
    data: Delegate;
    accountMeta: {
      treeInfo: PackedStateTreeInfo;
      address: Uint8Array<ArrayBuffer>;
      outputStateTreeIndex: number;
    };
  }[]
): Promise<DelegateCreateOrMutateArgs | undefined> {
  if (!isDelegate(m.permissions)) return;
  const delegateAddress = await getCachedDelegateAddress(m.pubkey);
  const createArg = delegateCreateArgs.find((arg) =>
    arg.address.eq(delegateAddress)
  );
  if (createArg) {
    return { __kind: "Create", fields: [createArg] };
  }
  const mutArg = delegateMutArgs.find((arg) =>
    new BN(arg.accountMeta.address).eq(delegateAddress)
  );
  if (mutArg) {
    return { __kind: "Mutate", fields: [mutArg] };
  }
  return;
}

async function getDelegateRemoveArgs(
  pubkey: Secp256r1Key | Address,
  delegateMutArgs: {
    data: Delegate;
    accountMeta: {
      treeInfo: PackedStateTreeInfo;
      address: Uint8Array<ArrayBuffer>;
      outputStateTreeIndex: number;
    };
  }[]
) {
  const delegateAddress = await getCachedDelegateAddress(pubkey);
  return delegateMutArgs.find((arg) =>
    new BN(arg.accountMeta.address).eq(delegateAddress)
  );
}
