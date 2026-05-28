import { type TransactionSigner } from "@solana/kit";
import { getCreateUserAccountInstruction, UserRole } from "../../generated";
import { getUserAddress } from "../../utils";

type UserCreationArgs =
  | {
      member: TransactionSigner;
      role: UserRole.TransactionManager;
      transactionManagerUrl: string;
    }
  | {
      member: TransactionSigner;
      role: UserRole.Member;
    };

export async function createUserAccounts({
  createUserArgs,
  payer,
}: {
  payer: TransactionSigner;
  createUserArgs: UserCreationArgs;
}) {
  return getCreateUserAccountInstruction({
    payer,
    member: createUserArgs.member,
    role: createUserArgs.role,
    transactionManagerUrl:
      createUserArgs.role === UserRole.TransactionManager
        ? createUserArgs.transactionManagerUrl
        : null,
    userAccount: await getUserAddress(createUserArgs.member.address),
    remainingAccounts: [],
  });
}
