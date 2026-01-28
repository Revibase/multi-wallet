import {
  convertMemberKeyToString,
  getCreateUserAccountsInstructionDataDecoder,
  getEditTransactionManagerUrlInstructionDataDecoder,
} from "@revibase/core";
import type { Instruction } from "gill";
import type { TransactionManagerConfig } from "../types";

export function processCreateUserAccounts(
  instruction: Instruction,
  transactionManager: TransactionManagerConfig,
) {
  if (!instruction.data) {
    throw new Error("Invalid instruction data");
  }

  const decodedData = getCreateUserAccountsInstructionDataDecoder().decode(
    instruction.data,
  );

  for (const userArg of decodedData.createUserArgs) {
    if (userArg.member.toString() !== transactionManager.publicKey) {
      throw new Error(
        `Public Key does not match ${transactionManager.publicKey}`,
      );
    }

    if (userArg.transactionManagerUrl?.__option === "None") {
      throw new Error("Transaction endpoint cannot be empty");
    }

    if (userArg.transactionManagerUrl?.value !== transactionManager.url) {
      throw new Error(
        `Transaction endpoint not equal to ${transactionManager.url}`,
      );
    }
  }
  return null;
}

export function processEditTransactionManagerUrl(
  instruction: Instruction,
  transactionManager: TransactionManagerConfig,
) {
  if (!instruction.data) {
    throw new Error("Invalid instruction data");
  }

  const decodedData =
    getEditTransactionManagerUrlInstructionDataDecoder().decode(
      instruction.data,
    );

  const memberKey = convertMemberKeyToString(
    decodedData.userMutArgs.data.member,
  );
  if (memberKey !== transactionManager.publicKey) {
    throw new Error(
      `Public Key does not match ${transactionManager.publicKey}`,
    );
  }

  if (decodedData.transactionManagerUrl !== transactionManager.url) {
    throw new Error(
      `Transaction endpoint not equal to ${transactionManager.url}`,
    );
  }

  return null;
}
