import {
  AccountRole,
  Address,
  IAccountMeta,
  IAccountSignerMeta,
  IInstruction,
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
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

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

  const payload = [];

  const { verifyArgs, domainConfig, signature, message, publicKey } =
    await extractSecp256r1VerificationArgs(
      dedupSigners.find((x) => x instanceof Secp256r1Key)
    );

  if (message && signature && publicKey) {
    payload.push({
      message,
      signature,
      publicKey,
    });
  }

  for (const action of configActions) {
    switch (action.type) {
      case "AddMembers":
        for (const x of action.members) {
          if (Permissions.has(x.permissions, Permission.IsDelegate)) {
            remainingAccounts.push({
              address: await getDelegateAddress(x.pubkey),
              role: AccountRole.WRITABLE,
            });
          }
        }

        const { signature, message, publicKey, domainConfig } =
          await extractSecp256r1VerificationArgs(
            action.members
              .map((x) => x.pubkey)
              .find((x) => x instanceof Secp256r1Key)
          );

        if (message && signature && publicKey) {
          payload.push({
            message,
            signature,
            publicKey,
          });
        }

        if (domainConfig) {
          remainingAccounts.push({
            address: domainConfig,
            role: AccountRole.READONLY,
          });
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

  const instructions: IInstruction[] = [];
  if (payload.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction({ payload }));
  }

  instructions.push(
    getChangeConfigInstruction({
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      configActions: convertConfigActionWrapper(configActions),
      settings,
      payer: feePayer,
      remainingAccounts,
    })
  );
  return instructions;
}
