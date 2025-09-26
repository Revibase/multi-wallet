import { AccountRole, type Instruction, type TransactionSigner } from "gill";
import {
  getCreateMultiWalletCompressedInstruction,
  getCreateMultiWalletInstruction,
  getUserDecoder,
  type User,
} from "../generated";
import { Secp256r1Key } from "../types";
import {
  getCompressedSettingsAddressFromIndex,
  getGlobalCounterAddress,
  getSettingsFromIndex,
  getUserAddress,
} from "../utils";
import {
  convertToCompressedProofArgs,
  getCompressedAccountHashes,
  getCompressedAccountInitArgs,
  getCompressedAccountMutArgs,
  getNewAddressesParams,
  getValidityProofWithRetry,
} from "../utils/compressed/internal";
import { PackedAccounts } from "../utils/compressed/packedAccounts";
import { extractSecp256r1VerificationArgs } from "../utils/internal";
import type { Secp256r1VerifyInput } from "./secp256r1Verify";

type CreateWalletArgs = {
  index: bigint | number;
  payer: TransactionSigner;
  compressed?: boolean;
  cachedCompressedAccounts?: Map<string, any>;
  initialMember: TransactionSigner | Secp256r1Key;
  setAsDelegate: boolean;
};
export async function createWallet({
  index,
  payer,
  initialMember,
  setAsDelegate,
  compressed = false,
  cachedCompressedAccounts,
}: CreateWalletArgs) {
  const globalCounter = await getGlobalCounterAddress();
  const {
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    slotHashSysvar,
    message,
    signature,
    publicKey,
  } = extractSecp256r1VerificationArgs(initialMember);

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  if (message && signature && publicKey) {
    secp256r1VerifyInput.push({
      message,
      signature,
      publicKey,
    });
  }

  const packedAccounts = new PackedAccounts();
  await packedAccounts.addSystemAccounts();

  const newAddressParams = [];
  const hashesWithTree = [];

  hashesWithTree.push(
    ...(await getCompressedAccountHashes(
      [
        {
          address: getUserAddress(
            "address" in initialMember ? initialMember.address : initialMember
          ),
          type: "User" as const,
        },
      ],
      cachedCompressedAccounts
    ))
  );

  if (compressed) {
    const settingsAddress = getCompressedSettingsAddressFromIndex(index);
    newAddressParams.push(
      ...getNewAddressesParams([
        {
          pubkey: settingsAddress,
          type: "Settings" as const,
        },
      ])
    );
  }
  const hashesWithTreeEndIndex = hashesWithTree.length;

  const proof = await getValidityProofWithRetry(
    hashesWithTree,
    newAddressParams
  );

  const userMutArgs = getCompressedAccountMutArgs<User>(
    packedAccounts,
    proof.treeInfos.slice(0, hashesWithTreeEndIndex),
    proof.leafIndices.slice(0, hashesWithTreeEndIndex),
    proof.rootIndices.slice(0, hashesWithTreeEndIndex),
    proof.proveByIndices.slice(0, hashesWithTreeEndIndex),
    hashesWithTree.filter((x) => x.type === "User"),
    getUserDecoder()
  )[0];

  const initArgs = await getCompressedAccountInitArgs(
    packedAccounts,
    proof.treeInfos.slice(hashesWithTreeEndIndex),
    proof.roots.slice(hashesWithTreeEndIndex),
    proof.rootIndices.slice(hashesWithTreeEndIndex),
    newAddressParams,
    hashesWithTreeEndIndex > 0
      ? proof.treeInfos.slice(0, hashesWithTreeEndIndex)
      : undefined
  );

  const settingsCreationArgs =
    initArgs.find((x) => x.type === "Settings") ?? null;

  if (domainConfig) {
    packedAccounts.addPreAccounts([
      { address: domainConfig, role: AccountRole.READONLY },
    ]);
  } else if ("address" in initialMember) {
    packedAccounts.addPreAccounts([
      {
        address: initialMember.address,
        role: AccountRole.READONLY_SIGNER,
        signer: initialMember,
      },
    ]);
  }

  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  const instructions: Instruction[] = [];
  if (compressed) {
    if (!settingsCreationArgs) {
      throw new Error("Settings creation args is missing.");
    }

    instructions.push(
      getCreateMultiWalletCompressedInstruction({
        settingsIndex: index,
        instructionsSysvar,
        slotHashSysvar,
        payer: payer,
        initialMember:
          initialMember instanceof Secp256r1Key ? undefined : initialMember,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        userMutArgs,
        globalCounter,
        compressedProofArgs,
        settingsCreation: settingsCreationArgs,
        setAsDelegate,
        remainingAccounts,
      })
    );
  } else {
    const settings = await getSettingsFromIndex(index);
    instructions.push(
      getCreateMultiWalletInstruction({
        settings,
        instructionsSysvar,
        slotHashSysvar,
        payer,
        initialMember:
          initialMember instanceof Secp256r1Key ? undefined : initialMember,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        userMutArgs,
        globalCounter,
        compressedProofArgs,
        setAsDelegate,
        remainingAccounts,
      })
    );
  }

  return { instructions, secp256r1VerifyInput };
}
