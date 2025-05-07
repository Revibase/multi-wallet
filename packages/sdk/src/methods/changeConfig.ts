import {
  AccountRole,
  Address,
  IAccountMeta,
  IAccountSignerMeta,
  TransactionSigner,
} from "@solana/kit";
import { getChangeConfigInstruction } from "../generated";
import {
  ConfigActionWrapper,
  Permission,
  Permissions,
  Secp256r1Key,
} from "../types";
import { getDelegateAddress } from "../utils";
import {
  convertConfigActionWrapper,
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/internal";

export async function changeConfig({
  settings,
  feePayer,
  signers,
  configActions,
}: {
  feePayer: TransactionSigner;
  signers: (TransactionSigner | Secp256r1Key)[];
  settings: Address;
  configActions: ConfigActionWrapper[];
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const remainingAccounts: (IAccountMeta | IAccountSignerMeta)[] = dedupSigners
    .filter((x) => !(x instanceof Secp256r1Key))
    .map(
      (x) =>
        ({
          address: (x as TransactionSigner).address,
          role: AccountRole.READONLY_SIGNER,
          signer: x,
        }) as IAccountSignerMeta
    );
  const { verifyArgs, domainConfig } = extractSecp256r1VerificationArgs(
    dedupSigners.find((x) => x instanceof Secp256r1Key)
  );
  for (const action of configActions) {
    switch (action.type) {
      case "AddMembers":
        for (const x of action.members) {
          if (x.pubkey instanceof Secp256r1Key) {
            if (domainConfig) {
              remainingAccounts.push({
                address: domainConfig,
                role: AccountRole.READONLY,
              });
            } else {
              throw new Error(
                "Domain config cannot be null for Secp256r1Key. It needs to be linked to a domain config address."
              );
            }
          }
          if (Permissions.has(x.permissions, Permission.IsDelegate)) {
            remainingAccounts.push({
              address: await getDelegateAddress(x.pubkey),
              role: AccountRole.WRITABLE,
            });
          }
        }
        break;
      case "RemoveMembers":
        remainingAccounts.push(
          ...(await Promise.all(
            action.members.map(async (x) => ({
              address: await getDelegateAddress(x),
              role: AccountRole.WRITABLE,
            }))
          ))
        );
        break;
    }
  }

  return getChangeConfigInstruction({
    secp256r1VerifyArgs: verifyArgs,
    domainConfig,
    configActions: convertConfigActionWrapper(configActions),
    settings,
    payer: feePayer,
    remainingAccounts,
  });
}
