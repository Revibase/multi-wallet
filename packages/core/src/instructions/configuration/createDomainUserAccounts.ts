import { type Address, none, some, type TransactionSigner } from "gill";
import {
  type CompressedSettings,
  getCompressedSettingsDecoder,
  getCreateDomainUserAccountInstruction,
  getSecp256r1PubkeyDecoder,
  getUserDecoder,
  type SettingsMutArgs,
  type User,
  type UserMutArgs,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import {
  getCompressedSettingsAddressFromIndex,
  getUserAccountAddress,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

interface UserCreationArgs {
  member: Secp256r1Key;
  isPermanentMember: boolean;
  settingsIndex?: number | bigint;
  transactionManager?: Address;
}

export async function createDomainUserAccounts({
  authority,
  payer,
  createUserArgs,
  domainConfig,
  cachedAccounts,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  payer: TransactionSigner;
  createUserArgs: UserCreationArgs;
  cachedAccounts?: Map<string, any>;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const addresses = [];

  if (createUserArgs.settingsIndex) {
    addresses.push({
      address: getCompressedSettingsAddressFromIndex(
        createUserArgs.settingsIndex
      ).address,
      type: "Settings" as const,
    });
    if (createUserArgs.transactionManager) {
      addresses.push({
        address: getUserAccountAddress(createUserArgs.transactionManager)
          .address,
        type: "User" as const,
      });
    }
  }

  const hashesWithTree = addresses.length
    ? await getCompressedAccountHashes(addresses, cachedAccounts)
    : [];
  const { address, addressTree } = getUserAccountAddress(createUserArgs.member);
  const newAddressParams = [
    {
      address,
      type: "User" as const,
      tree: addressTree,
      queue: addressTree,
    },
  ];

  const proof = await getValidityProofWithRetry(
    hashesWithTree,
    newAddressParams
  );

  let settingsMutArgs: SettingsMutArgs | null = null;
  let transactionManagerMutArgs: UserMutArgs | null = null;
  const settingsHash = hashesWithTree.filter((x) => x.type === "Settings");
  const transactionManagerHash = hashesWithTree.filter(
    (x) => x.type === "User"
  );
  if (settingsHash.length) {
    settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
      packedAccounts,
      proof.treeInfos.slice(0, 1),
      proof.leafIndices.slice(0, 1),
      proof.rootIndices.slice(0, 1),
      proof.proveByIndices.slice(0, 1),
      settingsHash,
      getCompressedSettingsDecoder()
    )[0];
  }
  if (transactionManagerHash.length) {
    transactionManagerMutArgs = getCompressedAccountMutArgs<User>(
      packedAccounts,
      proof.treeInfos.slice(1, 2),
      proof.leafIndices.slice(1, 2),
      proof.rootIndices.slice(1, 2),
      proof.proveByIndices.slice(1, 2),
      transactionManagerHash,
      getUserDecoder()
    )[0];
  }

  const userCreationArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos.slice(hashesWithTree.length),
    proof.roots.slice(hashesWithTree.length),
    proof.rootIndices.slice(hashesWithTree.length),
    newAddressParams
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return getCreateDomainUserAccountInstruction({
    payer,
    authority,
    compressedProofArgs,
    member: getSecp256r1PubkeyDecoder().decode(
      createUserArgs.member.toBuffer()
    ),
    isPermanentMember: createUserArgs.isPermanentMember,
    linkWalletArgs: settingsMutArgs
      ? some({
          settingsMutArgs,
          transactionManager: transactionManagerMutArgs
            ? some(transactionManagerMutArgs)
            : none(),
        })
      : none(),
    userAccountCreationArgs: userCreationArgs[0],
    domainConfig,
    remainingAccounts,
  });
}
