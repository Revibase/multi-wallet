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
  getCreateDomainDelegatesInstruction,
  getSecp256r1PubkeyDecoder,
  type LinkWalletArgs,
  type SettingsMutArgs,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import {
  getCompressedSettingsAddressFromIndex,
  getDelegateAddress,
  getDelegateExtensionsAddress,
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

interface DelegateCreationArgs {
  member: Secp256r1Key;
  isPermanentMember: boolean;
  linkedWalletSettingsIndex?: number | bigint;
  delegateExtensionsAuthority?: Address;
}

export async function createDomainDelegates({
  authority,
  payer,
  createDelegateArgs,
  domainConfig,
  cachedCompressedAccounts,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  payer: TransactionSigner;
  createDelegateArgs: DelegateCreationArgs[];
  cachedCompressedAccounts?: Map<string, any>;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const addresses = createDelegateArgs
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
    createDelegateArgs.map((args) => ({
      pubkey: getDelegateAddress(args.member),
      type: "Delegate",
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

  const delegateCreationArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos.slice(hashesWithTree.length),
    proof.roots.slice(hashesWithTree.length),
    proof.rootIndices.slice(hashesWithTree.length),
    newAddressParams
  );

  const set = new Set();
  for (const x of createDelegateArgs) {
    if (
      x.delegateExtensionsAuthority &&
      !set.has(x.delegateExtensionsAuthority)
    ) {
      packedAccounts.addPreAccounts([
        {
          address: await getDelegateExtensionsAddress(
            x.delegateExtensionsAuthority
          ),
          role: AccountRole.READONLY,
        },
      ]);
      set.add(x.delegateExtensionsAuthority);
    }
  }

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return getCreateDomainDelegatesInstruction({
    payer,
    authority,
    compressedProofArgs,
    createDelegateArgs: createDelegateArgs.map((x, index) => ({
      member: getSecp256r1PubkeyDecoder().decode(x.member.toBuffer()),
      delegateCreationArgs: delegateCreationArgs[index],
      isPermanentMember: x.isPermanentMember,
      linkWalletArgs: getLinkWalletArgs(
        x,
        settingsMutArgs,
        x.delegateExtensionsAuthority
      ),
    })),
    domainConfig,
    remainingAccounts,
  });
}

function getLinkWalletArgs(
  x: DelegateCreationArgs,
  settingsMutArgs: SettingsMutArgs[],
  delegateExtensionsAuthority?: Address
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
        delegateExtensionAuthority: delegateExtensionsAuthority
          ? some(delegateExtensionsAuthority)
          : none(),
      })
    : none();
}
