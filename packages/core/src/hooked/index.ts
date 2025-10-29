import {
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type TransactionSigner,
} from "gill";

export function parseRemainingAccounts({
  args,
}: {
  programAddress: Address;
  accounts?: any;
  args?: {
    remainingAccounts: {
      address: Address;
      role: number;
      signer?: TransactionSigner;
    }[];
  };
}): AccountMeta[] {
  if (!args) {
    return [];
  }
  const { remainingAccounts } = args;
  return remainingAccounts.map((x) =>
    x.signer
      ? ({
          address: x.address,
          role: x.role,
          signer: x.signer,
        } as AccountSignerMeta)
      : ({ address: x.address, role: x.role } as AccountMeta)
  );
}
