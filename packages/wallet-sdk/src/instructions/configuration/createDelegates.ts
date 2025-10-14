import { AccountRole, type TransactionSigner } from "gill";
import { getCreateDelegatesInstruction } from "../../generated";
import { getDelegateAddress, getDelegateExtensionsAddress } from "../../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountInitArgs,
  getNewAddressesParams,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";

type DelegateCreationArgs =
  | {
      member: TransactionSigner;
      isPermanentMember: boolean;
      apiUrl: undefined;
    }
  | {
      member: TransactionSigner;
      isPermanentMember: false;
      apiUrl: string;
    };

export async function createDelegates({
  createDelegateArgs,
  payer,
}: {
  payer: TransactionSigner;
  createDelegateArgs: DelegateCreationArgs[];
}) {
  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();
  packedAccounts.addPreAccounts(
    createDelegateArgs.map((x) => ({
      address: x.member.address,
      role: AccountRole.READONLY_SIGNER,
      signer: x.member,
    }))
  );
  const newAddressParams = getNewAddressesParams(
    createDelegateArgs.map((x) => ({
      pubkey: getDelegateAddress(x.member.address),
      type: "Delegate",
    }))
  );
  const proof = await getValidityProofWithRetry([], newAddressParams);
  const delegateCreationArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos,
    proof.roots,
    proof.rootIndices,
    newAddressParams
  );

  packedAccounts.addPreAccounts(
    await Promise.all(
      createDelegateArgs
        .filter((x) => !!x.apiUrl)
        .map(async (x) => ({
          address: await getDelegateExtensionsAddress(x.member.address),
          role: AccountRole.WRITABLE,
        }))
    )
  );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  return getCreateDelegatesInstruction({
    compressedProofArgs,
    payer,
    createDelegateArgs: createDelegateArgs.map((x, index) => ({
      member: x.member.address,
      isPermanentMember: x.isPermanentMember,
      delegateCreationArgs: delegateCreationArgs[index],
      apiUrl: x.apiUrl ?? null,
    })),
    remainingAccounts,
  });
}
