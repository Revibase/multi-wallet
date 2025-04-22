import {
  AccountRole,
  Address,
  IAccountMeta,
  IAccountSignerMeta,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { fetchSettingsData } from "../functions";
import { getChangeConfigInstruction } from "../generated";
import {
  ConfigActionWrapper,
  Permission,
  Permissions,
  Secp256r1Key,
} from "../types";
import { getDelegateAddress, getMemberKeyString } from "../utils";
import {
  convertConfigActionWrapper,
  convertMemberkeyToPubKey,
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../utils/private";

export async function changeConfig({
  rpc,
  settings,
  feePayer,
  signers,
  configActions,
}: {
  rpc: Rpc<SolanaRpcApi>;
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
            if (x.metadata) {
              remainingAccounts.push({
                address: x.metadata,
                role: AccountRole.READONLY,
              });
            } else {
              throw new Error(
                "Metadata cannot be null for Secp256r1Key. It needs to be linked to a domain config address."
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
      case "SetMembers":
        for (const x of action.members) {
          if (x.pubkey instanceof Secp256r1Key) {
            if (x.metadata) {
              remainingAccounts.push({
                address: x.metadata,
                role: AccountRole.READONLY,
              });
            } else {
              throw new Error(
                "Metadata cannot be null for Secp256r1Key. It needs to be linked to a domain config address."
              );
            }
          }
        }
        const settingsData = await fetchSettingsData(rpc, settings);
        if (!settingsData) {
          throw new Error("Unable to fetch settings data.");
        }
        const hashSet = new Set<string>();
        const delegateAccounts: (Address | Secp256r1Key)[] = [];
        action.members
          .filter(
            (f) =>
              !settingsData.members.some(
                (member) =>
                  getMemberKeyString(member.pubkey) === f.pubkey.toString()
              ) && Permissions.has(f.permissions, Permission.IsDelegate)
          )
          .forEach((f) => {
            if (!hashSet.has(f.pubkey.toString())) {
              delegateAccounts.push(f.pubkey);
              hashSet.add(f.pubkey.toString());
            }
          });

        settingsData.members
          .filter(
            (f) =>
              !action.members.some(
                (member) =>
                  member.pubkey.toString() === getMemberKeyString(f.pubkey)
              ) && Permissions.has(f.permissions, Permission.IsDelegate)
          )
          .forEach((f) => {
            const pubkey = convertMemberkeyToPubKey(f.pubkey);
            if (!hashSet.has(pubkey.toString())) {
              delegateAccounts.push(pubkey);
              hashSet.add(pubkey.toString());
            }
          });

        await Promise.all(
          delegateAccounts.map(async (x) =>
            remainingAccounts.push({
              address: await getDelegateAddress(x),
              role: AccountRole.WRITABLE,
            })
          )
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
