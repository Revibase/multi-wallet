import {
  type AccountMeta,
  type Address,
  none,
  type OptionOrNullable,
  some,
  type TransactionSigner,
} from "gill";
import {
  getEditDomainConfigInstruction,
  type NewAuthorityArgsArgs,
} from "../../generated";
import { getUserAccountAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewWhitelistedAddressTreeIndex,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

export async function editDomainConfig({
  authority,
  domainConfig,
  newAuthority,
  newOrigins,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  newAuthority?: TransactionSigner;
  newOrigins?: string[];
}) {
  let newAuthorityArgs: OptionOrNullable<NewAuthorityArgsArgs> = null;
  let remainingAccounts: AccountMeta[] = [];
  if (newAuthority) {
    const packedAccounts = new PackedAccounts();
    await packedAccounts.addSystemAccounts();

    const userAddressTreeIndex = await getNewWhitelistedAddressTreeIndex();

    const { address, addressTree } = await getUserAccountAddress(
      newAuthority.address,
      userAddressTreeIndex,
    );
    const newAddressParams = [
      {
        address,
        tree: addressTree,
        queue: addressTree,
        type: "User" as const,
      },
    ];

    const proof = await getValidityProofWithRetry([], newAddressParams);
    const authorityCreationArgs = (
      await getCompressedAccountInitArgs(
        packedAccounts,
        proof.treeInfos,
        proof.roots,
        proof.rootIndices,
        newAddressParams,
      )
    )[0];

    const accountMetas = packedAccounts.toAccountMetas();
    remainingAccounts = accountMetas.remainingAccounts;

    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      accountMetas.systemOffset,
    );

    newAuthorityArgs = { compressedProofArgs, authorityCreationArgs };
  }
  return getEditDomainConfigInstruction({
    domainConfig,
    authority,
    newOrigins: newOrigins ? some(newOrigins) : none(),
    newAuthorityArgs,
    newAuthority,
    remainingAccounts,
  });
}
