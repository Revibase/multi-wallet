import {
  AccountRole,
  type Address,
  address,
  getAddressEncoder,
  type Instruction,
  none,
  type OptionOrNullable,
  some,
  type TransactionSigner,
} from "gill";
import { getTransferSolInstruction } from "gill/programs";
import { JITO_TIP_ACCOUNTS } from "../../constants";
import { ValidationError } from "../../errors";
import type {
  MemberKey,
  Secp256r1VerifyArgsArgs,
  TransactionSyncSignersArgs,
} from "../../generated";
import type { Secp256r1VerifyInput } from "../../instructions/secp256r1Verify";
import { KeyType, Secp256r1Key, SignedSecp256r1Key } from "../../types";
import type { PackedAccounts } from "../compressed/packedAccounts";
import { getSecp256r1Message } from "../passkeys/internal";

export function extractSecp256r1VerificationArgs(
  signer?: SignedSecp256r1Key | TransactionSigner,
  index = 0,
) {
  const secp256r1PublicKey =
    signer instanceof SignedSecp256r1Key ? signer : undefined;
  const verifyArgs: OptionOrNullable<Secp256r1VerifyArgsArgs> =
    secp256r1PublicKey?.verifyArgs && index !== -1
      ? some({
          signedMessageIndex: index,
          truncatedClientDataJson:
            secp256r1PublicKey.verifyArgs.truncatedClientDataJson,
          slotNumber: secp256r1PublicKey.verifyArgs.slotNumber,
          originIndex: secp256r1PublicKey.originIndex,
          crossOrigin: secp256r1PublicKey.crossOrigin,
          clientAndDeviceHash: secp256r1PublicKey.clientAndDeviceHash,
        })
      : none();

  const domainConfig = secp256r1PublicKey?.domainConfig
    ? secp256r1PublicKey.domainConfig
    : undefined;
  const signature = secp256r1PublicKey?.verifyArgs
    ? secp256r1PublicKey.signature
    : undefined;
  const message =
    secp256r1PublicKey?.authData && secp256r1PublicKey.verifyArgs.clientDataJson
      ? getSecp256r1Message(secp256r1PublicKey.authResponse)
      : undefined;
  const publicKey = secp256r1PublicKey?.toBuffer();

  return {
    domainConfig,
    verifyArgs,
    signature,
    message,
    publicKey,
  };
}

export function buildSignerAccounts(
  dedupSigners: (TransactionSigner | SignedSecp256r1Key)[],
  packedAccounts: PackedAccounts,
  secp256r1VerifyInput: Secp256r1VerifyInput = [],
): {
  secp256r1VerifyInput: Secp256r1VerifyInput;
  transactionSyncSigners: TransactionSyncSignersArgs[];
} {
  const transactionSyncSigners: TransactionSyncSignersArgs[] = [];

  for (const x of dedupSigners) {
    if (x instanceof SignedSecp256r1Key) {
      const index = secp256r1VerifyInput.length;
      const { domainConfig, verifyArgs, signature, publicKey, message } =
        extractSecp256r1VerificationArgs(x, index);
      if (message && signature && publicKey) {
        secp256r1VerifyInput.push({ message, signature, publicKey });
      }
      if (domainConfig) {
        const domainConfigIndex = packedAccounts
          .addPreAccounts([
            { address: domainConfig, role: AccountRole.READONLY },
          ])
          .get(domainConfig)?.index;
        if (verifyArgs.__option === "Some" && domainConfigIndex !== undefined) {
          transactionSyncSigners.push({
            __kind: "Secp256r1",
            fields: [{ domainConfigIndex, verifyArgs: verifyArgs.value }],
          });
        }
      }
    } else {
      const index = packedAccounts
        .addPreAccounts([
          { address: x.address, role: AccountRole.READONLY_SIGNER, signer: x },
        ])
        .get(x.address)?.index;
      if (index !== undefined) {
        transactionSyncSigners.push({
          __kind: "Ed25519",
          fields: [index],
        });
      }
    }
  }

  return { secp256r1VerifyInput, transactionSyncSigners };
}

export function convertPubkeyToMemberkey(
  pubkey: TransactionSigner | Address | Secp256r1Key,
): MemberKey {
  if (pubkey instanceof Secp256r1Key) {
    return { keyType: KeyType.Secp256r1, key: pubkey.toBytes() };
  } else {
    let address;
    try {
      address = "address" in pubkey ? pubkey.address : pubkey;
    } catch {
      address = pubkey as Address;
    }
    return {
      keyType: KeyType.Ed25519,
      key: new Uint8Array([
        0, // pad start with zero to make it 33 bytes
        ...getAddressEncoder().encode(address),
      ]),
    };
  }
}

function getPubkeyString(pubkey: TransactionSigner | SignedSecp256r1Key) {
  if (pubkey instanceof SignedSecp256r1Key) {
    return pubkey.toString();
  } else {
    return pubkey.address.toString();
  }
}

export function getDeduplicatedSigners(
  signers: (SignedSecp256r1Key | TransactionSigner)[],
): (SignedSecp256r1Key | TransactionSigner)[] {
  const hashSet = new Set();
  const dedupSigners: (SignedSecp256r1Key | TransactionSigner)[] = [];
  for (const signer of signers) {
    if (!hashSet.has(getPubkeyString(signer))) {
      dedupSigners.push(signer);
      hashSet.add(getPubkeyString(signer));
    }
  }

  const secp256r1Signers = dedupSigners.filter(
    (x) => x instanceof SignedSecp256r1Key,
  );
  if (secp256r1Signers.length > 1) {
    throw new ValidationError(
      `More than 1 Secp256r1 signers in an instruction is not supported (found ${secp256r1Signers.length})`,
    );
  }
  return dedupSigners;
}

export function addJitoTip({
  payer,
  tipAmount,
}: {
  payer: TransactionSigner;
  tipAmount: number;
}): Instruction {
  const tipAccount =
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return getTransferSolInstruction({
    source: payer,
    destination: address(tipAccount),
    amount: tipAmount,
  });
}
