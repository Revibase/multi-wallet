import {
  AccountRole,
  address,
  getBase58Decoder,
  IAccountMeta,
  IAccountSignerMeta,
  none,
  some,
  TransactionSigner,
} from "@solana/kit";
import { getCreateInstruction } from "../generated";
import { Secp256r1Key } from "../types";
import { getDelegateAddress, getSettingsFromCreateKey } from "../utils";
import { extractSecp256r1VerificationArgs } from "../utils/internal";

export async function createWallet({
  feePayer,
  initialMember,
}: {
  feePayer: TransactionSigner;
  initialMember: TransactionSigner | Secp256r1Key;
}) {
  const remainingAccounts: (IAccountMeta | IAccountSignerMeta)[] = [];

  remainingAccounts.push({
    address: await getDelegateAddress(
      initialMember instanceof Secp256r1Key
        ? initialMember
        : initialMember.address
    ),
    role: AccountRole.WRITABLE,
  });

  const { domainConfig, verifyArgs } =
    extractSecp256r1VerificationArgs(initialMember);
  if (domainConfig) {
    remainingAccounts.push({
      address: domainConfig,
      role: AccountRole.READONLY,
    });
  }

  const settings = await getSettingsFromCreateKey(
    initialMember instanceof Secp256r1Key
      ? address(getBase58Decoder().decode(initialMember.toTruncatedBuffer()))
      : initialMember.address
  );

  return getCreateInstruction({
    payer: feePayer,
    settings,
    initialMember:
      initialMember instanceof Secp256r1Key ? undefined : initialMember,
    secp256r1VerifyArgs: verifyArgs,
    domainConfig: domainConfig ? some(domainConfig) : none(),
    remainingAccounts,
  });
}
