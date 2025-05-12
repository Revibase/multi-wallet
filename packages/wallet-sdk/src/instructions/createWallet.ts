import {
  AccountRole,
  IAccountMeta,
  IAccountSignerMeta,
  IInstruction,
  none,
  some,
  TransactionSigner,
} from "@solana/kit";
import { getCreateInstruction } from "../generated";
import { Secp256r1Key } from "../types";
import { getDelegateAddress, getSettingsFromInitialMember } from "../utils";
import { extractSecp256r1VerificationArgs } from "../utils/internal";
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

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

  const {
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    slotHashSysvar,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(initialMember);
  if (domainConfig) {
    remainingAccounts.push({
      address: domainConfig,
      role: AccountRole.READONLY,
    });
  }

  const settings = await getSettingsFromInitialMember(
    initialMember instanceof Secp256r1Key
      ? initialMember
      : initialMember.address
  );

  const instructions: IInstruction[] = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction({
        payload: [
          {
            message,
            signature,
            publicKey,
          },
        ],
      })
    );
  }

  instructions.push(
    getCreateInstruction({
      instructionsSysvar,
      slotHashSysvar,
      payer: feePayer,
      settings,
      initialMember:
        initialMember instanceof Secp256r1Key ? undefined : initialMember,
      secp256r1VerifyArgs: verifyArgs,
      domainConfig: domainConfig ? some(domainConfig) : none(),
      remainingAccounts,
    })
  );
  return instructions;
}
