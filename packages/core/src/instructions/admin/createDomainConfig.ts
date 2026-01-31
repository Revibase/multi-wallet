import { type TransactionSigner } from "gill";
import { getCreateDomainConfigInstructionAsync } from "../../generated";
import { getDomainConfigAddress, getUserAccountAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewWhitelistedAddressTreeIndex,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

export async function createDomainConfig({
  payer,
  rpId,
  origins,
  authority,
}: {
  payer: TransactionSigner;
  rpId: string;
  origins: string[];
  authority: TransactionSigner;
}) {
  const domainConfig = await getDomainConfigAddress({ rpId });
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const userAddressTreeIndex = await getNewWhitelistedAddressTreeIndex();

  const { address, addressTree } = await getUserAccountAddress(
    authority.address,
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

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return await getCreateDomainConfigInstructionAsync({
    origins,
    authorityCreationArgs,
    authority,
    compressedProofArgs,
    payer,
    domainConfig,
    rpId,
    remainingAccounts,
  });
}
