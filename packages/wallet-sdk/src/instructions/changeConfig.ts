import {
  AccountRole,
  Address,
  createNoopSigner,
  IAccountMeta,
  IAccountSignerMeta,
  IInstruction,
} from "@solana/kit";
import { getChangeConfigInstruction } from "../generated";
import {
  ConfigActionWrapper,
  Permission,
  Permissions,
  Secp256r1Key,
} from "../types";
import { getDelegateAddress, getMultiWalletFromSettings } from "../utils";
import {
  convertConfigActionWrapper,
  extractSecp256r1VerificationArgs,
} from "../utils/internal";
import { Secp256r1VerifyInput } from "./secp256r1Verify";

export async function changeConfig({
  settings,
  configActions,
}: {
  settings: Address;
  configActions: ConfigActionWrapper[];
}) {
  const multiWallet = await getMultiWalletFromSettings(settings);
  const remainingAccounts: (IAccountMeta | IAccountSignerMeta)[] = [];
  const secp256r1VerifyInput: Secp256r1VerifyInput = [];

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
          secp256r1VerifyInput.push({
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

  instructions.push(
    getChangeConfigInstruction({
      configActions: convertConfigActionWrapper(configActions),
      settings,
      payer: createNoopSigner(multiWallet),
      remainingAccounts,
    })
  );
  return { instructions, secp256r1VerifyInput };
}
