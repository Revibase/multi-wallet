import BN from "bn.js";
import {
  AccountRole,
  type Address,
  none,
  type OptionOrNullable,
  some,
  type TransactionSigner,
} from "gill";
import {
  type CompressedSettings,
  getCompressedSettingsDecoder,
  getCreateDomainUsersInstruction,
  getSecp256r1PubkeyDecoder,
  type LinkWalletArgs,
  type SettingsMutArgs,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import {
  getCompressedSettingsAddressFromIndex,
  getUserAddress,
  getUserExtensionsAddress,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewAddressesParams,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

interface UserCreationArgs {
  member: Secp256r1Key;
  isPermanentMember: boolean;
  linkedWalletSettingsIndex?: number | bigint;
  userExtensionsAuthority?: Address;
}

export async function createDomainUsers({
  authority,
  payer,
  createUserArgs,
  domainConfig,
  cachedCompressedAccounts,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  payer: TransactionSigner;
  createUserArgs: UserCreationArgs[];
  cachedCompressedAccounts?: Map<string, any>;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const addresses = createUserArgs
    .filter((x) => !!x.linkedWalletSettingsIndex)
    .map((x) => ({
      address: getCompressedSettingsAddressFromIndex(
        x.linkedWalletSettingsIndex!
      ),
      type: "Settings" as const,
    }));

  const hashesWithTree = addresses.length
    ? await getCompressedAccountHashes(addresses, cachedCompressedAccounts)
    : [];

  const newAddressParams = getNewAddressesParams(
    createUserArgs.map((args) => ({
      pubkey: getUserAddress(args.member),
      type: "User",
    }))
  );

  const proof = await getValidityProofWithRetry(
    hashesWithTree,
    newAddressParams
  );

  let settingsMutArgs: SettingsMutArgs[] = [];
  const settingsHash = hashesWithTree.filter((x) => x.type === "Settings");
  if (settingsHash.length) {
    settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
      packedAccounts,
      proof.treeInfos.slice(0, hashesWithTree.length),
      proof.leafIndices.slice(0, hashesWithTree.length),
      proof.rootIndices.slice(0, hashesWithTree.length),
      proof.proveByIndices.slice(0, hashesWithTree.length),
      settingsHash,
      getCompressedSettingsDecoder()
    );
  }

  const userCreationArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos.slice(hashesWithTree.length),
    proof.roots.slice(hashesWithTree.length),
    proof.rootIndices.slice(hashesWithTree.length),
    newAddressParams,
    hashesWithTree.length ? hashesWithTree.map((x) => x.treeInfo) : undefined
  );

  const set = new Set();
  for (const x of createUserArgs) {
    if (x.userExtensionsAuthority && !set.has(x.userExtensionsAuthority)) {
      packedAccounts.addPreAccounts([
        {
          address: await getUserExtensionsAddress(x.userExtensionsAuthority),
          role: AccountRole.READONLY,
        },
      ]);
      set.add(x.userExtensionsAuthority);
    }
  }

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return getCreateDomainUsersInstruction({
    payer,
    authority,
    compressedProofArgs,
    createUserArgs: createUserArgs.map((x, index) => ({
      member: getSecp256r1PubkeyDecoder().decode(x.member.toBuffer()),
      userCreationArgs: userCreationArgs[index],
      isPermanentMember: x.isPermanentMember,
      linkWalletArgs: getLinkWalletArgs(
        x,
        settingsMutArgs,
        x.userExtensionsAuthority
      ),
    })),
    domainConfig,
    remainingAccounts,
  });
}

function getLinkWalletArgs(
  x: UserCreationArgs,
  settingsMutArgs: SettingsMutArgs[],
  userExtensionsAuthority?: Address
): OptionOrNullable<LinkWalletArgs> {
  const result = x.linkedWalletSettingsIndex
    ? settingsMutArgs.find((y) =>
        new BN(new Uint8Array(y.accountMeta.address)).eq(
          getCompressedSettingsAddressFromIndex(x.linkedWalletSettingsIndex!)
        )
      )
    : undefined;

  return result
    ? some({
        settingsMutArgs: result,
        userExtensionAuthority: userExtensionsAuthority
          ? some(userExtensionsAuthority)
          : none(),
      })
    : none();
}
