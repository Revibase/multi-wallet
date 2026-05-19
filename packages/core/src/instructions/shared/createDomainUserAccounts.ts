import { type Address, type TransactionSigner } from "gill";
import {
  getCreateDomainUserAccountInstruction,
  getSecp256r1PubkeyDecoder,
  Transports,
  UserRole,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { base64URLStringToBuffer, getUserAddress } from "../../utils";

interface UserCreationArgs {
  member: Secp256r1Key;
  role: UserRole.Member | UserRole.PermanentMember;
  credentialId: string;
  transports: Transports[];
  settings?: Address;
  transactionManagerAccount?: Address;
}

export async function createDomainUserAccounts({
  authority,
  payer,
  createUserArgs,
  domainConfig,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  payer: TransactionSigner;
  createUserArgs: UserCreationArgs;
}) {
  return getCreateDomainUserAccountInstruction({
    payer,
    authority,
    member: getSecp256r1PubkeyDecoder().decode(
      createUserArgs.member.toBuffer(),
    ),
    credentialId: base64URLStringToBuffer(createUserArgs.credentialId),
    transports: createUserArgs.transports,
    role: createUserArgs.role,
    domainConfig,
    settings: createUserArgs.settings,
    transactionManagerAccount: createUserArgs.transactionManagerAccount,
    userAccount: await getUserAddress(createUserArgs.member),
    remainingAccounts: [],
  });
}
