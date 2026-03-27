import { type Address, none, some, type TransactionSigner } from "gill";
import {
  type CompressedSettings,
  getCompressedSettingsDecoder,
  getCreateDomainUserAccountInstructionAsync,
  getSecp256r1PubkeyDecoder,
  getUserDecoder,
  type SettingsMutArgs,
  Transports,
  type User,
  type UserMutArgs,
  UserRole,
} from "../../generated";
import { type AccountCache, Secp256r1Key } from "../../types";
import {
  base64URLStringToBuffer,
  getCompressedSettingsAddress,
  getUserAccountAddress,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewWhitelistedAddressTreeIndex,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

interface UserCreationArgs {
  member: Secp256r1Key;
  role: UserRole.Member | UserRole.PermanentMember;
  credentialId: string;
  transports: Transports[];
  settings?: Address;
  settingsAddressTreeIndex?: number;
  transactionManager?: {
    member: Address;
    userAddressTreeIndex?: number;
  };
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
  cachedAccounts?: AccountCache;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const addresses = [];

  if (createUserArgs.settings) {
    if (createUserArgs.transactionManager) {
      addresses.push({
        address: (
          await getUserAccountAddress(
            createUserArgs.transactionManager.member,
            createUserArgs.transactionManager.userAddressTreeIndex,
          )
        ).address,
        type: "User" as const,
      });
    }
    addresses.push({
      address: (
        await getCompressedSettingsAddress(
          createUserArgs.settings,
          createUserArgs.settingsAddressTreeIndex,
        )
      ).address,
      type: "Settings" as const,
    });
  }

  const hashesWithTree = addresses.length
    ? await getCompressedAccountHashes(addresses, cachedAccounts)
    : [];
  const userAddressTreeIndex = await getNewWhitelistedAddressTreeIndex();
  const { address, addressTree } = await getUserAccountAddress(
    createUserArgs.member,
    userAddressTreeIndex,
  );
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
    newAddressParams,
  );

  let settingsMutArgs: SettingsMutArgs | null = null;
  let transactionManagerMutArgs: UserMutArgs | null = null;
  const settingsHash = hashesWithTree.filter((x) => x.type === "Settings");
  const transactionManagerHash = hashesWithTree.filter(
    (x) => x.type === "User",
  );
  if (transactionManagerHash.length) {
    const start = 0;
    const end = 1;
    transactionManagerMutArgs = getCompressedAccountMutArgs<User>(
      packedAccounts,
      proof.treeInfos.slice(start, end),
      proof.leafIndices.slice(start, end),
      proof.rootIndices.slice(start, end),
      proof.proveByIndices.slice(start, end),
      transactionManagerHash,
      getUserDecoder(),
    )[0];
  }
  if (settingsHash.length) {
    const start = transactionManagerHash.length;
    const end = start + 1;
    settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
      packedAccounts,
      proof.treeInfos.slice(start, end),
      proof.leafIndices.slice(start, end),
      proof.rootIndices.slice(start, end),
      proof.proveByIndices.slice(start, end),
      settingsHash,
      getCompressedSettingsDecoder(),
    )[0];
  }
  const userAccountCreationArgs = (
    await getCompressedAccountInitArgs(
      packedAccounts,
      proof.treeInfos.slice(hashesWithTree.length),
      proof.roots.slice(hashesWithTree.length),
      proof.rootIndices.slice(hashesWithTree.length),
      newAddressParams,
    )
  )[0];

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return await getCreateDomainUserAccountInstructionAsync({
    payer,
    authority,
    compressedProofArgs,
    member: getSecp256r1PubkeyDecoder().decode(
      createUserArgs.member.toBuffer(),
    ),
    credentialId: base64URLStringToBuffer(createUserArgs.credentialId),
    transports: createUserArgs.transports,
    role: createUserArgs.role,
    linkWalletArgs: settingsMutArgs
      ? some({
          settingsMutArgs,
          transactionManager: transactionManagerMutArgs
            ? some(transactionManagerMutArgs)
            : none(),
        })
      : none(),
    userAccountCreationArgs,
    domainConfig,
    remainingAccounts,
  });
}
