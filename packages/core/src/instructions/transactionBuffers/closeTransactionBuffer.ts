import type { Address, TransactionSigner } from "gill";
import {
  fetchTransactionBuffer,
  getTransactionBufferCloseCompressedInstruction,
  getTransactionBufferCloseInstruction,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { getSolanaRpc } from "../../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../utils/compressed/internal";
import { extractSecp256r1VerificationArgs } from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function closeTransactionBuffer({
  settingsAddressTreeIndex,
  closer,
  transactionBufferAddress,
  payer,
  compressed = false,
  cachedAccounts,
}: {
  settingsAddressTreeIndex?: number;
  closer: TransactionSigner | SignedSecp256r1Key;
  transactionBufferAddress: Address;
  payer?: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  const transactionBuffer = await fetchTransactionBuffer(
    getSolanaRpc(),
    transactionBufferAddress,
  );
  const settings = transactionBuffer.data.multiWalletSettings;
  const { packedAccounts, proof, settingsMutArgs } =
    await constructSettingsProofArgs(
      compressed,
      settings,
      settingsAddressTreeIndex,
      false,
      cachedAccounts,
    );

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const { domainConfig, verifyArgs, message, signature, publicKey } =
    extractSecp256r1VerificationArgs(closer);

  const instructions = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([
        {
          message,
          signature,
          publicKey,
        },
      ]),
    );
  }

  if (compressed) {
    if (!payer || !settingsMutArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset,
    );

    instructions.push(
      getTransactionBufferCloseCompressedInstruction({
        transactionBuffer: transactionBufferAddress,
        domainConfig,
        closer: closer instanceof SignedSecp256r1Key ? undefined : closer,
        rentCollector: transactionBuffer.data.payer,
        secp256r1VerifyArgs: verifyArgs,
        settingsMutArgs,
        payer,
        compressedProofArgs,
        remainingAccounts,
      }),
    );
  } else {
    instructions.push(
      getTransactionBufferCloseInstruction({
        transactionBuffer: transactionBufferAddress,
        domainConfig,
        closer: closer instanceof SignedSecp256r1Key ? undefined : closer,
        settings,
        payer: transactionBuffer.data.payer,
        secp256r1VerifyArgs: verifyArgs,
        remainingAccounts: [],
      }),
    );
  }

  return instructions;
}
