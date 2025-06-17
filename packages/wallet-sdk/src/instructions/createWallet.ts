import {
  getAddressDecoder,
  IInstruction,
  TransactionSigner,
} from "@solana/kit";
import { getCreateInstructionAsync } from "../generated";
import { Permission, Permissions, Secp256r1Key } from "../types";
import { getDelegateAddress, getSettingsFromCreateKey } from "../utils";
import { extractSecp256r1VerificationArgs } from "../utils/internal";
import { Secp256r1VerifyInput } from "./secp256r1Verify";

export async function createWallet({
  feePayer,
  initialMember,
  createKey,
  permissions,
}: {
  feePayer: TransactionSigner;
  initialMember: TransactionSigner | Secp256r1Key;
  createKey: Uint8Array;
  permissions: Permissions;
}) {
  const {
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    slotHashSysvar,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(initialMember);

  const settings = await getSettingsFromCreateKey(createKey);

  const instructions: IInstruction[] = [];

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  if (message && signature && publicKey) {
    secp256r1VerifyInput.push({
      message,
      signature,
      publicKey,
    });
  }

  const delegateAccount = Permissions.has(permissions, Permission.IsDelegate)
    ? await getDelegateAddress(
        initialMember instanceof Secp256r1Key
          ? initialMember
          : initialMember.address
      )
    : undefined;

  instructions.push(
    await getCreateInstructionAsync({
      instructionsSysvar,
      slotHashSysvar,
      payer: feePayer,
      settings,
      initialMember:
        initialMember instanceof Secp256r1Key ? undefined : initialMember,
      secp256r1VerifyArgs: verifyArgs,
      delegateAccount,
      domainConfig,
      createKey: getAddressDecoder().decode(createKey),
      permissions,
    })
  );
  return { instructions, secp256r1VerifyInput };
}
