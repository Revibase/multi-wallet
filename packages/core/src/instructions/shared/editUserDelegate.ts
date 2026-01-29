import type { BN254 } from "@lightprotocol/stateless.js";
import {
  none,
  some,
  type Instruction,
  type OptionOrNullable,
  type TransactionSigner,
} from "gill";
import {
  getCompressedSettingsDecoder,
  getEditUserDelegateInstruction,
  getUserDecoder,
  type CompressedSettings,
  type SettingsIndexWithAddress,
  type SettingsMutArgs,
  type User,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import {
  fetchSettingsAccountData,
  fetchUserAccountData,
  getCompressedSettingsAddressFromIndex,
  getSettingsFromIndex,
  getUserAccountAddress,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";
import { extractSecp256r1VerificationArgs } from "../../utils/transaction/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "../secp256r1Verify";

export async function editUserDelegate({
  payer,
  user,
  userAddressTreeIndex,
  newDelegate,
  cachedAccounts = new Map(),
}: {
  payer: TransactionSigner;
  user: TransactionSigner | SignedSecp256r1Key;
  userAddressTreeIndex?: number;
  cachedAccounts?: Map<string, any>;
  newDelegate?: SettingsIndexWithAddress;
}) {
  const { domainConfig, verifyArgs, message, signature, publicKey } =
    extractSecp256r1VerificationArgs(user);

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  if (message && signature && publicKey) {
    secp256r1VerifyInput.push({
      message,
      signature,
      publicKey,
    });
  }

  const userAccount = await fetchUserAccountData(
    user instanceof SignedSecp256r1Key ? user : user.address,
    userAddressTreeIndex,
    cachedAccounts,
  );

  const addresses: {
    address: BN254;
    type: "Settings" | "User";
  }[] = [];
  addresses.push({
    address: (
      await getUserAccountAddress(
        user instanceof SignedSecp256r1Key ? user : user.address,
        userAddressTreeIndex,
      )
    ).address,
    type: "User",
  });

  let oldSettings;
  let oldSettingsIndexes: { start: number; end: number } | null = null;
  let newSettings;
  let newSettingsIndexes: { start: number; end: number } | null = null;
  const old_delegate = userAccount.wallets.find((x) => x.isDelegate);
  if (old_delegate) {
    const settings = await fetchSettingsAccountData(
      old_delegate.index,
      old_delegate.settingsAddressTreeIndex,
      cachedAccounts,
    );
    if (settings.isCompressed) {
      addresses.push({
        address: (
          await getCompressedSettingsAddressFromIndex(
            old_delegate.index,
            old_delegate.settingsAddressTreeIndex,
          )
        ).address,
        type: "Settings",
      });
      oldSettingsIndexes = {
        start: addresses.length - 1,
        end: addresses.length,
      };
    } else {
      oldSettings = await getSettingsFromIndex(old_delegate.index);
    }
  }
  if (newDelegate) {
    const settings = await fetchSettingsAccountData(
      newDelegate.index,
      newDelegate.settingsAddressTreeIndex,
      cachedAccounts,
    );
    if (settings.isCompressed) {
      addresses.push({
        address: (
          await getCompressedSettingsAddressFromIndex(
            newDelegate.index,
            newDelegate.settingsAddressTreeIndex,
          )
        ).address,
        type: "Settings",
      });
      newSettingsIndexes = {
        start: addresses.length - 1,
        end: addresses.length,
      };
    } else {
      newSettings = await getSettingsFromIndex(newDelegate.index);
    }
  }

  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const hashesWithTree = await getCompressedAccountHashes(
    addresses,
    cachedAccounts,
  );
  const proof = await getValidityProofWithRetry(hashesWithTree, []);
  const userMutArgs = getCompressedAccountMutArgs<User>(
    packedAccounts,
    proof.treeInfos.slice(0, 1),
    proof.leafIndices.slice(0, 1),
    proof.rootIndices.slice(0, 1),
    proof.proveByIndices.slice(0, 1),
    hashesWithTree.slice(0, 1),
    getUserDecoder(),
  )[0];

  const oldSettingsMutArgs: OptionOrNullable<SettingsMutArgs> =
    oldSettingsIndexes
      ? some(
          getCompressedAccountMutArgs<CompressedSettings>(
            packedAccounts,
            proof.treeInfos.slice(
              oldSettingsIndexes.start,
              oldSettingsIndexes.end,
            ),
            proof.leafIndices.slice(
              oldSettingsIndexes.start,
              oldSettingsIndexes.end,
            ),
            proof.rootIndices.slice(
              oldSettingsIndexes.start,
              oldSettingsIndexes.end,
            ),
            proof.proveByIndices.slice(
              oldSettingsIndexes.start,
              oldSettingsIndexes.end,
            ),
            hashesWithTree.slice(
              oldSettingsIndexes.start,
              oldSettingsIndexes.end,
            ),
            getCompressedSettingsDecoder(),
          )[0],
        )
      : none();

  const newSettingsMutArgs: OptionOrNullable<SettingsMutArgs> =
    newSettingsIndexes
      ? some(
          getCompressedAccountMutArgs<CompressedSettings>(
            packedAccounts,
            proof.treeInfos.slice(
              newSettingsIndexes.start,
              newSettingsIndexes.end,
            ),
            proof.leafIndices.slice(
              newSettingsIndexes.start,
              newSettingsIndexes.end,
            ),
            proof.rootIndices.slice(
              newSettingsIndexes.start,
              newSettingsIndexes.end,
            ),
            proof.proveByIndices.slice(
              newSettingsIndexes.start,
              newSettingsIndexes.end,
            ),
            hashesWithTree.slice(
              newSettingsIndexes.start,
              newSettingsIndexes.end,
            ),
            getCompressedSettingsDecoder(),
          )[0],
        )
      : none();

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  const instructions: Instruction[] = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }
  instructions.push(
    getEditUserDelegateInstruction({
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      delegateTo: newDelegate ? some(newDelegate) : none(),
      feePayer: payer,
      signer: user instanceof SignedSecp256r1Key ? undefined : user,
      oldSettings,
      oldSettingsMutArgs,
      newSettings,
      newSettingsMutArgs,
      compressedProofArgs,
      userMutArgs,
      remainingAccounts,
    }),
  );

  return instructions;
}
