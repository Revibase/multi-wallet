import { BN254, ValidityProofWithContext } from "@lightprotocol/stateless.js";
import { AccountRole, createNoopSigner } from "@solana/kit";
import BN from "bn.js";
import {
  getCompressedSettingsAddressFromIndex,
  getDelegateAddress,
} from "../compressed";
import {
  convertToCompressedProofArgs,
  getCompressedAccountCloseArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewAddressesParams,
} from "../compressed/internal";
import { PackedAccounts } from "../compressed/packedAccounts";
import {
  CompressedSettings,
  Delegate,
  getChangeConfigCompressedInstruction,
  getChangeConfigInstruction,
  getCompressedSettingsDecoder,
  getDelegateDecoder,
} from "../generated";
import {
  ConfigActionWrapper,
  ConfigActionWrapperWithDelegateArgs,
  Permission,
  Permissions,
  Secp256r1Key,
} from "../types";
import {
  getLightProtocolRpc,
  getMultiWalletFromSettings,
  getSettingsFromIndex,
} from "../utils";
import {
  convertConfigActionWrapper,
  extractSecp256r1VerificationArgs,
} from "../utils/internal";
import { Secp256r1VerifyInput } from "./secp256r1Verify";

export async function changeConfig({
  index,
  configActions,
  compressed = false,
}: {
  index: bigint | number;
  configActions: ConfigActionWrapper[];
  compressed?: boolean;
}) {
  const settings = await getSettingsFromIndex(index);
  const multiWallet = await getMultiWalletFromSettings(settings);
  const packedAccounts = new PackedAccounts();

  let proof: ValidityProofWithContext | null = null;

  const addDelegates = configActions
    .filter((x) => x.type === "AddMembers")
    .flatMap((x) =>
      x.members.filter((m) =>
        Permissions.has(m.permissions, Permission.IsDelegate)
      )
    );

  const removeDelegates = configActions
    .filter((x) => x.type === "RemoveMembers")
    .flatMap((x) =>
      x.members.filter((m) =>
        Permissions.has(m.permissions, Permission.IsDelegate)
      )
    );

  let newAddresses = [];
  let hashesWithTree = [];

  if (addDelegates.length || removeDelegates.length || compressed) {
    await packedAccounts.addSystemAccounts();
    const addresses: { pubkey: BN254; type: "Settings" | "Delegate" }[] = [];
    if (removeDelegates.length) {
      addresses.push(
        ...(await Promise.all(
          removeDelegates.map(async (m) => ({
            pubkey: await getDelegateAddress(m.pubkey),
            type: "Delegate" as const,
          }))
        ))
      );
    }
    if (compressed) {
      addresses.push({
        pubkey: await getCompressedSettingsAddressFromIndex(index),
        type: "Settings",
      });
    }
    if (addresses.length) {
      hashesWithTree.push(...(await getCompressedAccountHashes(addresses)));
    }

    if (addDelegates.length) {
      newAddresses.push(
        ...getNewAddressesParams(
          await Promise.all(
            addDelegates.map(async (m) => ({
              pubkey: await getDelegateAddress(m.pubkey),
              type: "Delegate",
            }))
          )
        )
      );
    }
    proof = await getLightProtocolRpc().getValidityProofV0(
      hashesWithTree,
      newAddresses
    );
  }

  const hashesWithTreeEndIndex = hashesWithTree.length;
  const settingsIndex = compressed ? hashesWithTreeEndIndex - 1 : null;
  const delegateEndIndex = settingsIndex ?? hashesWithTreeEndIndex;

  const delegateCreationArgs =
    addDelegates.length && proof
      ? await getCompressedAccountInitArgs(
          packedAccounts,
          proof.treeInfos.slice(hashesWithTreeEndIndex),
          proof.roots.slice(hashesWithTreeEndIndex),
          proof.rootIndices.slice(hashesWithTreeEndIndex),
          newAddresses,
          settingsIndex !== null
            ? proof.treeInfos.slice(settingsIndex, hashesWithTreeEndIndex)
            : undefined
        )
      : [];

  const settingsMutArgs =
    settingsIndex !== null && proof
      ? (
          await getCompressedAccountMutArgs<CompressedSettings>(
            packedAccounts,
            proof.treeInfos.slice(settingsIndex, hashesWithTreeEndIndex),
            proof.leafIndices.slice(settingsIndex, hashesWithTreeEndIndex),
            proof.rootIndices.slice(settingsIndex, hashesWithTreeEndIndex),
            proof.proveByIndices.slice(settingsIndex, hashesWithTreeEndIndex),
            hashesWithTree.filter((x) => x.type === "Settings"),
            getCompressedSettingsDecoder()
          )
        )[0]
      : null;

  const delegateCloseArgs =
    removeDelegates.length && proof
      ? await getCompressedAccountCloseArgs<Delegate>(
          packedAccounts,
          proof.treeInfos.slice(0, delegateEndIndex),
          proof.leafIndices.slice(0, delegateEndIndex),
          proof.rootIndices.slice(0, delegateEndIndex),
          proof.proveByIndices.slice(0, delegateEndIndex),
          hashesWithTree.filter((x) => x.type === "Delegate"),
          getDelegateDecoder()
        )
      : [];

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const configActionsWithDelegate: ConfigActionWrapperWithDelegateArgs[] = [];
  for (const action of configActions) {
    switch (action.type) {
      case "AddMembers": {
        const firstSecpKey = action.members.find(
          (m) => m.pubkey instanceof Secp256r1Key
        )?.pubkey as Secp256r1Key;
        if (firstSecpKey) {
          const { signature, message, publicKey, domainConfig } =
            await extractSecp256r1VerificationArgs(firstSecpKey);
          if (signature && message && publicKey) {
            secp256r1VerifyInput.push({ message, signature, publicKey });
          }
          if (domainConfig) {
            packedAccounts.addPreAccounts([
              {
                address: domainConfig,
                role: AccountRole.READONLY,
              },
            ]);
          }
        }

        const enrichedMembers = await Promise.all(
          action.members.map(async (m) => {
            const delegateAddress = await getDelegateAddress(m.pubkey);
            const delegateArgs = delegateCreationArgs.find((arg) =>
              arg.address.eq(delegateAddress)
            );
            return { ...m, delegateArgs };
          })
        );

        configActionsWithDelegate.push({ ...action, members: enrichedMembers });
        break;
      }

      case "RemoveMembers": {
        const enrichedMembers = await Promise.all(
          action.members.map(async (m) => {
            const delegateAddress = await getDelegateAddress(m.pubkey);
            const match = delegateCloseArgs.find((arg) =>
              new BN(arg.accountMeta.address).eq(delegateAddress)
            );
            return { ...m, delegateArgs: match };
          })
        );

        configActionsWithDelegate.push({ ...action, members: enrichedMembers });
        break;
      }

      default:
        configActionsWithDelegate.push(action);
        break;
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
        payer: createNoopSigner(multiWallet),
        compressedProofArgs,
        data: settingsMutArgs.data,
        accountMeta: settingsMutArgs.accountMeta,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getChangeConfigInstruction({
        configActions: configurations,
        settings,
        payer: createNoopSigner(multiWallet),
        compressedProofArgs,
        remainingAccounts,
      })
    );
  }

  return { instructions, secp256r1VerifyInput };
}
