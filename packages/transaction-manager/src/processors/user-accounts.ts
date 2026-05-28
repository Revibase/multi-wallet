import {
  parseCreateUserAccountInstruction,
  parseEditTransactionManagerUrlInstruction,
} from "@revibase/core";
import type { Instruction } from "@solana/kit";
import type { TransactionManagerConfig } from "../types";

/**
 * Processes a CreateUserAccount instruction.
 */
export function processCreateUserAccount(
  instruction: Instruction,
  transactionManagerConfig: TransactionManagerConfig,
) {
  if (!instruction.data || !instruction.accounts) {
    throw new Error("Invalid instruction");
  }

  const decodedInstruction = parseCreateUserAccountInstruction({
    programAddress: instruction.programAddress,
    data: instruction.data,
    accounts: instruction.accounts,
  });

  if (
    decodedInstruction.accounts.member.address.toString() !==
    transactionManagerConfig.publicKey
  ) {
    throw new Error(
      `Member public key mismatch. Expected: ${transactionManagerConfig.publicKey}, ` +
        `got: ${decodedInstruction.accounts.member.address.toString()}`,
    );
  }

  if (decodedInstruction.data.transactionManagerUrl?.__option === "None") {
    throw new Error(
      "Transaction manager URL cannot be empty when creating user accounts",
    );
  }

  if (
    decodedInstruction.data.transactionManagerUrl.value !==
    transactionManagerConfig.url
  ) {
    throw new Error(
      `Transaction manager URL mismatch. Expected: ${transactionManagerConfig.url}, ` +
        `got: ${decodedInstruction.data.transactionManagerUrl.value}`,
    );
  }

  return null;
}

/**
 * Processes an EditTransactionManagerUrl instruction.
 */
export function processEditTransactionManagerUrl(
  instruction: Instruction,
  transactionManagerConfig: TransactionManagerConfig,
) {
  if (!instruction.data || !instruction.accounts) {
    throw new Error("Invalid instruction ");
  }

  const decodedInstruction = parseEditTransactionManagerUrlInstruction({
    programAddress: instruction.programAddress,
    data: instruction.data,
    accounts: instruction.accounts,
  });

  const memberPublicKey = decodedInstruction.accounts.signer.address.toString();

  if (memberPublicKey !== transactionManagerConfig.publicKey) {
    throw new Error(
      `Member public key mismatch. Expected: ${transactionManagerConfig.publicKey}, ` +
        `got: ${memberPublicKey}`,
    );
  }

  if (
    decodedInstruction.data.transactionManagerUrl !==
    transactionManagerConfig.url
  ) {
    throw new Error(
      `Transaction manager URL mismatch. Expected: ${transactionManagerConfig.url}, ` +
        `got: ${decodedInstruction.data.transactionManagerUrl}`,
    );
  }

  return null;
}
