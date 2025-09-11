import { CompressedSettings } from "@revibase/wallet-sdk";
import {
  Address,
  none,
  OptionOrNullable,
  some,
  TransactionSigner,
} from "@solana/kit";
import BN from "bn.js";
import {
  getCompressedSettingsDecoder,
  getCreateDomainUsersInstruction,
  getSecp256r1PubkeyDecoder,
  SettingsMutArgs,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import {
  getCompressedSettingsAddressFromIndex,
  getLightProtocolRpc,
  getUserAddress,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewAddressesParams,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

interface UserCreationArgs {
  member: Secp256r1Key;
  isPermanentMember: boolean;
  linkedWalletSettingsIndex?: number | bigint;
}

export async function createDomainUsers({
  authority,
  payer,
  createUserArgs,
  domainConfig,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  payer: TransactionSigner;
  createUserArgs: UserCreationArgs[];
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
    ? await getCompressedAccountHashes(addresses)
    : [];

  const newAddressParams = getNewAddressesParams(
    createUserArgs.map((args) => ({
      pubkey: getUserAddress(args.member),
      type: "User",
    }))
  );

  const proof = await getLightProtocolRpc().getValidityProofV0(
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
      linkWalletArgs: getLinkWalletArgs(x, settingsMutArgs),
    })),
    domainConfig,
    remainingAccounts,
  });
}

function getLinkWalletArgs(
  x: UserCreationArgs,
  settingsMutArgs: SettingsMutArgs[]
): OptionOrNullable<SettingsMutArgs> {
  const result = x.linkedWalletSettingsIndex
    ? settingsMutArgs.find((y) =>
        new BN(new Uint8Array(y.accountMeta.address)).eq(
          getCompressedSettingsAddressFromIndex(x.linkedWalletSettingsIndex!)
        )
      )
    : undefined;

  return result ? some(result) : none();
}
