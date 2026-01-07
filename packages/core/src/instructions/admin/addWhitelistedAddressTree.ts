import type { Address, TransactionSigner } from "gill";
import { getAddWhitelistedAddressTreesInstructionAsync } from "../../generated";

export async function addWhitelistedAddressTrees({
  admin,
  addressTree,
}: {
  admin: TransactionSigner;
  addressTree: Address;
}) {
  return getAddWhitelistedAddressTreesInstructionAsync({
    payer: admin,
    addressTree,
    remainingAccounts: [],
  });
}
