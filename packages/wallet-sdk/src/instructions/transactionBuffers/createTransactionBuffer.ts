import { Address, TransactionSigner } from "@solana/kit";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../compressed/internal";
import { PackedAccounts } from "../../compressed/packedAccounts";
import {
  getTransactionBufferCreateCompressedInstruction,
  getTransactionBufferCreateInstruction,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { getSettingsFromIndex } from "../../utils";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function createTransactionBuffer({
  index,
  payer,
  creator,
  bufferIndex,
  transactionBufferAddress,
  finalBufferHash,
  finalBufferSize,
  permissionlessExecution,
  bufferExtendHashes,
  compressed = false,
}: {
  finalBufferHash: Uint8Array;
  finalBufferSize: number;
  payer: TransactionSigner;
  index: bigint | number;
  creator: TransactionSigner | Secp256r1Key;
  bufferIndex: number;
  transactionBufferAddress: Address;
  permissionlessExecution: boolean;
  bufferExtendHashes: Uint8Array[];
  compressed?: boolean;
}) {
  const settings = await getSettingsFromIndex(index);
  const packedAccounts = new PackedAccounts();
  const { settingsReadonlyArgs, proof } = await constructSettingsProofArgs(
    packedAccounts,
    compressed,
    index
  );
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(creator);
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
      getTransactionBufferCreateCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        payer,
        secp256r1VerifyArgs: verifyArgs,
        creator: creator instanceof Secp256r1Key ? undefined : creator,
        domainConfig,
        args: {
          bufferIndex,
          finalBufferHash,
          finalBufferSize,
          bufferExtendHashes,
          permissionlessExecution,
        },
        settingsReadonly: settingsReadonlyArgs,
        compressedProofArgs,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTransactionBufferCreateInstruction({
        instructionsSysvar,
        slotHashSysvar,
        settings,
        transactionBuffer: transactionBufferAddress,
        payer,
        secp256r1VerifyArgs: verifyArgs,
        creator: creator instanceof Secp256r1Key ? undefined : creator,
        domainConfig,
        args: {
          bufferIndex,
          finalBufferHash,
          finalBufferSize,
          bufferExtendHashes,
          permissionlessExecution,
        },
      })
    );
  }

  return instructions;
}
