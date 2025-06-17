import {
  AccountRole,
  Address,
  GetAccountInfoApi,
  IAccountSignerMeta,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import {
  fetchMaybeDelegate,
  getNativeTransferIntentInstructionAsync,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { getDelegateAddress, getMultiWalletFromSettings } from "../../utils";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function nativeTransferIntent({
  rpc,
  creator,
  additionalVoters,
  destination,
  amount,
}: {
  rpc: Rpc<GetAccountInfoApi>;
  creator: TransactionSigner | Secp256r1Key;
  additionalVoters?: (TransactionSigner | Secp256r1Key)[];
  destination: Address;
  amount: number;
}) {
  const delegateData = await fetchMaybeDelegate(
    rpc,
    await getDelegateAddress(
      creator instanceof Secp256r1Key ? creator : creator.address
    )
  );
  if (!delegateData.exists) {
    throw new Error(
      "Missing delegate account: Signer is not authorized for delegated transfers."
    );
  }
  const multiWallet = await getMultiWalletFromSettings(
    delegateData.data.multiWalletSettings
  );

  const accountInfo = await rpc.getAccountInfo(multiWallet).send();
  if ((accountInfo.value?.lamports ?? 0) < amount) {
    throw new Error(`Insufficient balance.`);
  }

  const signers = getDeduplicatedSigners(
    [creator].concat(additionalVoters ?? [])
  );

  const remainingAccounts = signers
    .filter((x) => !(x instanceof Secp256r1Key))
    .map(
      (x) =>
        ({
          address: (x as TransactionSigner).address,
          signer: x,
          role: AccountRole.READONLY_SIGNER,
        }) as IAccountSignerMeta
    );

  const {
    slotHashSysvar,
    instructionsSysvar,
    domainConfig,
    verifyArgs,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(
    signers.find((x) => x instanceof Secp256r1Key)
  );

  const instructions: IInstruction[] = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([
        {
          message,
          signature,
          publicKey,
        },
      ])
    );
  }
  instructions.push(
    await getNativeTransferIntentInstructionAsync({
      settings: delegateData.data.multiWalletSettings,
      domainConfig,
      destination,
      amount,
      secp256r1VerifyArgs: verifyArgs,
      slotHashSysvar,
      instructionsSysvar,
      remainingAccounts,
    })
  );

  return instructions;
}
