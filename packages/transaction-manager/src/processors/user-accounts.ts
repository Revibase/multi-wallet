import {
  convertMemberKeyToString,
  getCreateUserAccountsInstructionDataDecoder,
  getEditTransactionManagerUrlInstructionDataDecoder,
} from "@revibase/core";
import type { Instruction } from "gill";
import type { TransactionManagerConfig } from "../types";

/**
 * Processes a CreateUserAccounts instruction.
 */
export function processCreateUserAccounts(
  instruction: Instruction,
  transactionManagerConfig: TransactionManagerConfig,
) {
  if (!instruction.data) {
    throw new Error("Invalid instruction data");
  }

  const decodedInstructionData =
    getCreateUserAccountsInstructionDataDecoder().decode(instruction.data);

  for (const createUserArgs of decodedInstructionData.createUserArgs) {
    if (
      createUserArgs.member.toString() !== transactionManagerConfig.publicKey
    ) {
      throw new Error(
        `Member public key mismatch. Expected: ${transactionManagerConfig.publicKey}, ` +
          `got: ${createUserArgs.member.toString()}`,
      );
    }

    if (createUserArgs.transactionManagerUrl?.__option === "None") {
      throw new Error(
        "Transaction manager URL cannot be empty when creating user accounts",
      );
    }

    if (
      createUserArgs.transactionManagerUrl?.value !==
      transactionManagerConfig.url
    ) {
      throw new Error(
        `Transaction manager URL mismatch. Expected: ${transactionManagerConfig.url}, ` +
          `got: ${createUserArgs.transactionManagerUrl?.value}`,
      );
    }
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
  if (!instruction.data) {
    throw new Error("Invalid instruction data");
  }

  const decodedInstructionData =
    getEditTransactionManagerUrlInstructionDataDecoder().decode(
      instruction.data,
    );

  const memberPublicKey = convertMemberKeyToString(
    decodedInstructionData.userMutArgs.data.member,
  );

  if (memberPublicKey !== transactionManagerConfig.publicKey) {
    throw new Error(
      `Member public key mismatch. Expected: ${transactionManagerConfig.publicKey}, ` +
        `got: ${memberPublicKey}`,
    );
  }

  if (
    decodedInstructionData.transactionManagerUrl !==
    transactionManagerConfig.url
  ) {
    throw new Error(
      `Transaction manager URL mismatch. Expected: ${transactionManagerConfig.url}, ` +
        `got: ${decodedInstructionData.transactionManagerUrl}`,
    );
  }

  return null;
}
