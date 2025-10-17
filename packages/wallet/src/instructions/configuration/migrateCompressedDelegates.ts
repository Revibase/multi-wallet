import { address, type TransactionSigner } from "gill";
import {
  getMigrateCompressedDelegatesInstruction,
  type DelegateArgs,
} from "../../generated";
import { KeyType, Secp256r1Key } from "../../types";
import { convertMemberKeyToString, getDelegateAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

export async function migrateDelegates({
  args,
  authority,
}: {
  authority: TransactionSigner;
  args: DelegateArgs;
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const newAddressParams = getNewAddressesParams([
    {
      pubkey: getDelegateAddress(
        args.member.keyType === KeyType.Ed25519
          ? address(convertMemberKeyToString(args.member))
          : new Secp256r1Key(convertMemberKeyToString(args.member))
      ),
      type: "Delegate",
    },
  ]);
  const proof = await getValidityProofWithRetry([], newAddressParams);
  const delegateCreationArgs = (
    await getCompressedAccountInitArgs(
      packedAccounts,
      proof.treeInfos,
      proof.roots,
      proof.rootIndices,
      newAddressParams
    )
  )[0];

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return getMigrateCompressedDelegatesInstruction({
    compressedProofArgs,
    args,
    authority,
    delegateCreationArgs,
    remainingAccounts,
  });
}
