import {
  AccountRole,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "gill";
import { getAssociatedTokenAccountAddress } from "gill/programs";
import {
  getTokenTransferIntentCompressedInstruction,
  getTokenTransferIntentInstruction,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import {
  getSettingsFromIndex,
  getWalletAddressFromSettings,
} from "../../utils";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../utils/compressed/internal";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "../secp256r1Verify";

export async function tokenTransferIntent({
  index,
  destination,
  mint,
  signers,
  cachedAccounts,
  amount,
  payer,
  tokenProgram,
  compressed = false,
}: {
  index: number | bigint;
  destination: Address;
  mint: Address;
  amount: number | bigint;
  signers: (TransactionSigner | Secp256r1Key)[];
  tokenProgram: Address;
  payer?: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const settings = await getSettingsFromIndex(index);
  const walletAddress = await getWalletAddressFromSettings(settings);
  const [sourceTokenAccount, destinationTokenAccount] = await Promise.all([
    getAssociatedTokenAccountAddress(mint, walletAddress, tokenProgram),
    getAssociatedTokenAccountAddress(mint, destination, tokenProgram),
  ]);
  const { settingsReadonlyArgs, proof, packedAccounts } =
    await constructSettingsProofArgs(compressed, index, false, cachedAccounts);

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];
  for (const x of dedupSigners) {
    if (x instanceof Secp256r1Key) {
      const index = secp256r1VerifyInput.length;
      const { domainConfig, verifyArgs, signature, publicKey, message } =
        extractSecp256r1VerificationArgs(x, index);
      if (message && signature && publicKey) {
        secp256r1VerifyInput.push({ message, signature, publicKey });
      }
      if (domainConfig) {
        packedAccounts.addPreAccounts([
          { address: domainConfig, role: AccountRole.READONLY },
        ]);
        if (verifyArgs?.__option === "Some") {
          secp256r1VerifyArgs.push({
            domainConfigKey: domainConfig,
            verifyArgs: verifyArgs.value,
          });
        }
      }
    } else {
      packedAccounts.addPreAccounts([
        { address: x.address, role: AccountRole.READONLY_SIGNER, signer: x },
      ]);
    }
  }

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const instructions: Instruction[] = [];

  if (secp256r1VerifyInput.length > 0) {
    instructions.push(getSecp256r1VerifyInstruction(secp256r1VerifyInput));
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
      getTokenTransferIntentCompressedInstruction({
        amount,
        settingsReadonlyArgs: settingsReadonlyArgs,
        compressedProofArgs,
        payer,
        secp256r1VerifyArgs,
        source: walletAddress,
        sourceTokenAccount,
        destination,
        destinationTokenAccount,
        mint,
        tokenProgram,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTokenTransferIntentInstruction({
        amount,
        secp256r1VerifyArgs,
        source: walletAddress,
        sourceTokenAccount,
        destination,
        destinationTokenAccount,
        settings,
        mint,
        tokenProgram,
        remainingAccounts,
      })
    );
  }

  return instructions;
}
