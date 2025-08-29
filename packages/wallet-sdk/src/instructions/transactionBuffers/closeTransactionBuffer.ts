import { Address, TransactionSigner } from "@solana/kit";
import {
  fetchTransactionBuffer,
  getTransactionBufferCloseCompressedInstruction,
  getTransactionBufferCloseInstruction,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { getSolanaRpc } from "../../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../utils/compressed/internal";
import { extractSecp256r1VerificationArgs } from "../../utils/transactionMessage/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function closeTransactionBuffer({
  index,
  closer,
  transactionBufferAddress,
  payer,
  compressed = false,
}: {
  index: bigint | number;
  closer: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: Address;
  payer?: TransactionSigner;
  compressed?: boolean;
}) {
  const transactionBuffer = await fetchTransactionBuffer(
    getSolanaRpc(),
    transactionBufferAddress
  );
  const settings = transactionBuffer.data.multiWalletSettings;
  const { settingsReadonlyArgs, proof, packedAccounts } =
    await constructSettingsProofArgs(compressed, index);

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const {
    slotHashSysvar,
    instructionsSysvar,
    domainConfig,
    verifyArgs,
    message,
    signature,
    publicKey,
  } = extractSecp256r1VerificationArgs(closer);

  const instructions = [];
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

  if (compressed) {
    if (!payer || !settingsReadonlyArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset
    );

    instructions.push(
      getTransactionBufferCloseCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        domainConfig,
        closer: closer instanceof Secp256r1Key ? undefined : closer,
        rentCollector: transactionBuffer.data.payer,
        secp256r1VerifyArgs: verifyArgs,
        settingsReadonly: settingsReadonlyArgs,
        payer,
        compressedProofArgs,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTransactionBufferCloseInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        domainConfig,
        closer: closer instanceof Secp256r1Key ? undefined : closer,
        settings,
        payer: transactionBuffer.data.payer,
        secp256r1VerifyArgs: verifyArgs,
      })
    );
  }

  return instructions;
}
