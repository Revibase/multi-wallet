import { none, some, type Instruction, type TransactionSigner } from "gill";
import { getEditUserDelegateInstruction } from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { getSettingsFromIndex, getUserAddress } from "../../utils";
import { extractSecp256r1VerificationArgs } from "../../utils/transaction/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "../secp256r1Verify";

export async function editUserDelegate({
  payer,
  user,
  oldDelegate,
  newDelegate,
}: {
  payer: TransactionSigner;
  user: TransactionSigner | SignedSecp256r1Key;
  oldDelegate?: number;
  newDelegate?: number;
}) {
  let oldSettings;
  let newSettings;
  if (oldDelegate !== undefined) {
    oldSettings = await getSettingsFromIndex(oldDelegate);
  }
  if (newDelegate !== undefined) {
    newSettings = await getSettingsFromIndex(newDelegate);
  }
  const { domainConfig, verifyArgs, message, signature, publicKey } =
    extractSecp256r1VerificationArgs(user);

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  if (message && signature && publicKey) {
    secp256r1VerifyInput.push({
      message,
      signature,
      publicKey,
    });
  }

  const instructions: Instruction[] = [];
  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
  }
  instructions.push(
    getEditUserDelegateInstruction({
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      delegateTo: newDelegate !== undefined ? some(newDelegate) : none(),
      feePayer: payer,
      signer: user instanceof SignedSecp256r1Key ? undefined : user,
      oldSettings,
      newSettings,
      userAccount: await getUserAddress(
        user instanceof SignedSecp256r1Key ? user : user.address,
      ),
      remainingAccounts: [],
    }),
  );

  return instructions;
}
