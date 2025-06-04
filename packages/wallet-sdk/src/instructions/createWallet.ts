import {
  getAddressDecoder,
  IInstruction,
  TransactionSigner,
} from "@solana/kit";
import { getCreateInstructionAsync } from "../generated";
import { Secp256r1Key } from "../types";
import { getDelegateAddress, getSettingsFromCreateKey } from "../utils";
import { extractSecp256r1VerificationArgs } from "../utils/internal";
import { getSecp256r1VerifyInstruction } from "./secp256r1Verify";

export async function createWallet({
  feePayer,
  initialMember,
  createKey,
}: {
  feePayer: TransactionSigner;
  initialMember: TransactionSigner | Secp256r1Key;
  createKey: Uint8Array;
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
  const delegateAccount = await getDelegateAddress(
    initialMember instanceof Secp256r1Key
      ? initialMember
      : initialMember.address
  );

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
    })
  );
  return instructions;
}
