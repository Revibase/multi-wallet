import {
  CTOKEN_PROGRAM_ID,
  type CompressedAccount,
  type HashWithTree,
  type ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  AccountRole,
  address,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  none,
  some,
  type Address,
  type Instruction,
  type OptionOrNullable,
  type TransactionSigner,
} from "gill";
import {
  getAssociatedTokenAccountAddress,
  getTokenDecoder,
} from "gill/programs";
import {
  getCompressedSettingsDecoder,
  getTokenTransferIntentCompressedInstruction,
  getTokenTransferIntentInstruction,
  type CompressedSettings,
  type CompressedTokenArgsArgs,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
  type SettingsMutArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import {
  getCompressedSettingsAddressFromIndex,
  getSettingsFromIndex,
  getWalletAddressFromSettings,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  fetchCachedAccountInfo,
  fetchCachedCompressedTokenAccountsByOwner,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
} from "../../utils/compressed/internal";
import { PackedAccounts } from "../../utils/compressed/packedAccounts";
import {
  extractSecp256r1VerificationArgs,
  getDeduplicatedSigners,
} from "../../utils/transaction/internal";
import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyInput,
} from "../secp256r1Verify";

const compressibleConfig = address(
  "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg"
);
const rentSponsor = address("r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti");

export async function tokenTransferIntent({
  index,
  settingsAddressTreeIndex,
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
  settingsAddressTreeIndex?: number;
  destination: Address;
  mint: Address;
  amount: number | bigint;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  tokenProgram: Address;
  payer: TransactionSigner;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const settings = await getSettingsFromIndex(index);
  const walletAddress = await getWalletAddressFromSettings(settings);

  const [
    sourceSplAta,
    [sourceCtokenAta],
    destinationSplAta,
    [destinationCTokenAta],
    [splInterfacePda],
  ] = await Promise.all([
    getAssociatedTokenAccountAddress(mint, walletAddress, tokenProgram),
    getProgramDerivedAddress({
      seeds: [
        getAddressEncoder().encode(walletAddress),
        getAddressEncoder().encode(address(CTOKEN_PROGRAM_ID.toString())),
        getAddressEncoder().encode(mint),
      ],
      programAddress: address(CTOKEN_PROGRAM_ID.toString()),
    }),
    getAssociatedTokenAccountAddress(mint, destination, tokenProgram),
    getProgramDerivedAddress({
      seeds: [
        getAddressEncoder().encode(destination),
        getAddressEncoder().encode(address(CTOKEN_PROGRAM_ID.toString())),
        getAddressEncoder().encode(mint),
      ],
      programAddress: address(CTOKEN_PROGRAM_ID.toString()),
    }),
    getProgramDerivedAddress({
      seeds: [
        getUtf8Encoder().encode("pool"),
        getAddressEncoder().encode(mint),
      ],
      programAddress: address(CTOKEN_PROGRAM_ID.toString()),
    }),
  ]);

  const [destinationSplAtaInfo, sourceSplAtaInfo, compressedSettings] =
    await Promise.all([
      fetchCachedAccountInfo(destinationSplAta, cachedAccounts),
      fetchCachedAccountInfo(sourceSplAta, cachedAccounts),
      getCompressedSettings(
        compressed,
        index,
        settingsAddressTreeIndex,
        cachedAccounts
      ),
    ]);
  const destinationSplExists = !!destinationSplAtaInfo.value;
  const sourceSplExists = !!sourceSplAtaInfo.value;

  const splBalance = sourceSplExists
    ? getTokenDecoder().decode(
        getBase64Encoder().encode(sourceSplAtaInfo.value.data[0])
      ).amount
    : BigInt(0);

  let cTokenBalance = BigInt(0);
  if (splBalance < BigInt(amount)) {
    const sourceCTokenAccount = await fetchCachedAccountInfo(
      sourceCtokenAta,
      cachedAccounts
    );
    cTokenBalance = sourceCTokenAccount.value
      ? BigInt(
          parseTokenData(
            new Uint8Array(
              getBase64Encoder().encode(sourceCTokenAccount.value.data[0])
            )
          )?.amount.toNumber() ?? 0
        )
      : BigInt(0);
  }

  const destinationSplTokenAccount = destinationSplExists
    ? destinationSplAta
    : undefined;
  const destinationCtokenTokenAccount = destinationSplExists
    ? undefined
    : destinationCTokenAta;

  const requireSplInterface =
    (sourceSplExists &&
      (cTokenBalance > BigInt(0) ||
        splBalance + cTokenBalance < BigInt(amount) ||
        !!destinationCtokenTokenAccount)) ||
    (!sourceSplExists && !!destinationSplTokenAccount);

  const requireRentSponsor = !!destinationCtokenTokenAccount;

  const [{ parsed, compressedAccount }, splInterfaceNeedsInitialization] =
    await Promise.all([
      getCompressedTokenAccount(
        walletAddress,
        mint,
        splBalance,
        cTokenBalance,
        BigInt(amount),
        cachedAccounts
      ),
      checkIfSplInterfaceNeedsToBeInitialized(
        requireSplInterface,
        splInterfacePda,
        cachedAccounts
      ),
    ]);

  let settingsMutArgs: SettingsMutArgs | null = null;
  let proof: ValidityProofWithContext | null = null;
  const packedAccounts = new PackedAccounts();

  if (splInterfaceNeedsInitialization) {
    packedAccounts.addPreAccounts([
      { address: mint, role: AccountRole.WRITABLE },
    ]);
  }

  if (compressedSettings || compressedAccount) {
    await packedAccounts.addSystemAccounts();
    const hashesWithTree: (HashWithTree & {
      data: CompressedAccount["data"];
      address: CompressedAccount["address"];
    })[] = [];
    if (compressedAccount) {
      hashesWithTree.push({
        hash: compressedAccount.hash,
        tree: compressedAccount.treeInfo.tree,
        queue: compressedAccount.treeInfo.queue,
        data: compressedAccount.data,
        address: compressedAccount.address,
      });
    }
    if (compressedSettings) {
      hashesWithTree.push(compressedSettings);
    }
    proof = await getValidityProofWithRetry(hashesWithTree, []);
    if (compressedSettings) {
      const start = compressedAccount ? 1 : 0;
      settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
        packedAccounts,
        proof.treeInfos.slice(start),
        proof.leafIndices.slice(start),
        proof.rootIndices.slice(start),
        proof.proveByIndices.slice(start),
        hashesWithTree.slice(start),
        getCompressedSettingsDecoder()
      )[0];
    }
  }

  const compressedTokenAccount: OptionOrNullable<CompressedTokenArgsArgs> =
    compressedAccount && parsed && proof
      ? some({
          amount: parsed.amount.toNumber(),
          merkleContext: {
            leafIndex: compressedAccount.leafIndex,
            merkleTreePubkeyIndex: packedAccounts.insertOrGet(
              compressedAccount.treeInfo.tree.toString()
            ),
            queuePubkeyIndex: packedAccounts.insertOrGet(
              compressedAccount.treeInfo.queue.toString()
            ),
            proveByIndex: compressedAccount.proveByIndex,
          },
          rootIndex: proof.rootIndices[0],
          version: getVersionFromDiscriminator(
            compressedAccount.data?.discriminator
          ),
        })
      : none();

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];
  for (const x of dedupSigners) {
    if (x instanceof SignedSecp256r1Key) {
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
  const compressedProofArgs = convertToCompressedProofArgs(proof, systemOffset);

  if (compressed) {
    if (!settingsMutArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    instructions.push(
      getTokenTransferIntentCompressedInstruction({
        amount,
        settingsMutArgs,
        compressedProofArgs,
        payer,
        secp256r1VerifyArgs,
        source: walletAddress,
        destination,
        sourceCtokenTokenAccount: sourceCtokenAta,
        sourceSplTokenAccount: sourceSplAta,
        destinationCtokenTokenAccount,
        destinationSplTokenAccount,
        mint,
        tokenProgram,
        remainingAccounts,
        compressedTokenAccount,
        compressibleConfig,
        splInterfacePda: requireSplInterface ? splInterfacePda : undefined,
        rentSponsor: requireRentSponsor ? rentSponsor : undefined,
      })
    );
  } else {
    instructions.push(
      getTokenTransferIntentInstruction({
        amount,
        secp256r1VerifyArgs,
        source: walletAddress,
        destination,
        destinationCtokenTokenAccount,
        destinationSplTokenAccount,
        settings,
        mint,
        tokenProgram,
        remainingAccounts,
        payer,
        compressedTokenAccount,
        compressedProofArgs,
        sourceSplTokenAccount: sourceSplAta,
        sourceCtokenTokenAccount: sourceCtokenAta,
        compressibleConfig,
        splInterfacePda: requireSplInterface ? splInterfacePda : undefined,
        rentSponsor: requireRentSponsor ? rentSponsor : undefined,
      })
    );
  }

  return instructions;
}

async function checkIfSplInterfaceNeedsToBeInitialized(
  requireSplInterface: boolean,
  splInterfacePda: Address,
  cachedAccounts?: Map<string, any>
) {
  let needsInitialization = false;
  if (requireSplInterface) {
    const { value } = await fetchCachedAccountInfo(
      splInterfacePda,
      cachedAccounts
    );
    needsInitialization = !value;
  }
  return needsInitialization;
}

async function getCompressedTokenAccount(
  walletAddress: string,
  mint: string,
  splBalance: bigint,
  cTokenBalance: bigint,
  total: bigint,
  cachedAccounts?: Map<string, any>
) {
  if (splBalance + cTokenBalance >= total) {
    return {};
  }
  const compressedResult = await fetchCachedCompressedTokenAccountsByOwner(
    new PublicKey(walletAddress),
    { mint: new PublicKey(mint) },
    cachedAccounts
  );

  const compressedAccount =
    compressedResult.items.length > 0 ? compressedResult.items[0] : null;

  if (!compressedAccount) {
    return {};
  }
  if (!compressedAccount.compressedAccount.data?.data.length) {
    return {};
  }
  if (!compressedAccount.compressedAccount.owner.equals(CTOKEN_PROGRAM_ID)) {
    return {};
  }

  return {
    compressedAccount: compressedAccount.compressedAccount,
    parsed: compressedAccount.parsed,
  };
}

async function getCompressedSettings(
  compressed: boolean,
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: Map<string, any>
) {
  if (!compressed) return null;
  const { address: settingsAddress } =
    await getCompressedSettingsAddressFromIndex(
      index,
      settingsAddressTreeIndex
    );
  const settings = (
    await getCompressedAccountHashes(
      [{ address: settingsAddress, type: "Settings" }],
      cachedAccounts
    )
  )[0];

  return settings;
}

/**
 * Token data version enum - mirrors Rust TokenDataVersion
 * Used for compressed token account hashing strategy
 */
enum TokenDataVersion {
  /** V1: Poseidon hash with little-endian amount, discriminator [2,0,0,0,0,0,0,0] */
  V1 = 1,
  /** V2: Poseidon hash with big-endian amount, discriminator [0,0,0,0,0,0,0,3] */
  V2 = 2,
  /** ShaFlat: SHA256 hash of borsh-serialized data, discriminator [0,0,0,0,0,0,0,4] */
  ShaFlat = 3,
}
/**
 * Get token data version from compressed account discriminator.
 */
function getVersionFromDiscriminator(
  discriminator: number[] | undefined
): number {
  if (!discriminator || discriminator.length < 8) {
    // Default to ShaFlat for new accounts without discriminator
    return TokenDataVersion.ShaFlat;
  }

  // V1 has discriminator[0] = 2
  if (discriminator[0] === 2) {
    return TokenDataVersion.V1;
  }

  // V2 and ShaFlat have version in discriminator[7]
  const versionByte = discriminator[7];
  if (versionByte === 3) {
    return TokenDataVersion.V2;
  }
  if (versionByte === 4) {
    return TokenDataVersion.ShaFlat;
  }

  // Default to ShaFlat
  return TokenDataVersion.ShaFlat;
}
function parseTokenData(data: Uint8Array): {
  mint: PublicKey;
  owner: PublicKey;
  amount: BN;
  delegate: PublicKey | null;
  state: number;
  tlv: Uint8Array | null;
} | null {
  if (!data || data.length === 0) return null;

  try {
    let offset = 0;
    const mint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const owner = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const amount = new BN(data.slice(offset, offset + 8), "le");
    offset += 8;
    const delegateOption = data[offset];
    offset += 1;
    const delegate = delegateOption
      ? new PublicKey(data.slice(offset, offset + 32))
      : null;
    offset += 32;
    const state = data[offset];
    offset += 1;
    const tlvOption = data[offset];
    offset += 1;
    const tlv = tlvOption ? data.slice(offset) : null;

    return {
      mint,
      owner,
      amount,
      delegate,
      state,
      tlv,
    };
  } catch (error) {
    console.error("Token data parsing error:", error);
    return null;
  }
}
