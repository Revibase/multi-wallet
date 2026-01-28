import {
  type CompressedAccount,
  type HashWithTree,
  type ParsedTokenAccount,
  type ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import {
  AccountRole,
  address,
  getAddressEncoder,
  getArrayDecoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getU64Decoder,
  getU8Encoder,
  getUtf8Encoder,
  none,
  some,
  type Address,
  type Instruction,
  type OptionOrNullable,
  type TransactionSigner,
} from "gill";
import {
  AccountState,
  getAssociatedTokenAccountAddress,
  getTokenDecoder,
} from "gill/programs";
import {
  getCompressedSettingsDecoder,
  getExtensionStructDecoder,
  getTokenTransferIntentCompressedInstruction,
  getTokenTransferIntentInstruction,
  type CompressedSettings,
  type CompressedTokenArgsArgs,
  type Secp256r1VerifyArgsWithDomainAddressArgs,
  type SettingsMutArgs,
  type SplInterfacePdaArgsArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import {
  getCompressedSettingsAddressFromIndex,
  getLightProtocolRpc,
  getSettingsFromIndex,
  getWalletAddressFromSettings,
} from "../../utils";
import {
  convertToCompressedProofArgs,
  fetchCachedAccountInfo,
  getCompressedAccountHashes,
  getCompressedAccountMutArgs,
  getValidityProofWithRetry,
  getVersionFromDiscriminator,
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
  "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg",
);
const rentSponsor = address("r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti");

const ctokenProgramAddress = address(
  "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
);

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
  splInterfacePdaArgs = { index: 0, restricted: false },
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
  splInterfacePdaArgs?: SplInterfacePdaArgsArgs;
  compressed?: boolean;
  cachedAccounts?: Map<string, any>;
}) {
  const dedupSigners = getDeduplicatedSigners(signers);
  const settings = await getSettingsFromIndex(index);
  const walletAddress = await getWalletAddressFromSettings(settings);

  const getCtokenAta = (owner: Address) =>
    getProgramDerivedAddress({
      seeds: [
        getAddressEncoder().encode(owner),
        getAddressEncoder().encode(ctokenProgramAddress),
        getAddressEncoder().encode(mint),
      ],
      programAddress: ctokenProgramAddress,
    });

  const getSplInterfaceSeeds = () => {
    const baseSeeds = [
      getUtf8Encoder().encode("pool"),
      getAddressEncoder().encode(mint),
    ];
    if (splInterfacePdaArgs.restricted) {
      baseSeeds.push(getUtf8Encoder().encode("restricted"));
    }
    if (splInterfacePdaArgs.index > 0) {
      baseSeeds.push(getU8Encoder().encode(splInterfacePdaArgs.index));
    }
    return baseSeeds;
  };

  const [
    sourceSplAta,
    [sourceCtokenAta],
    destinationSplAta,
    [destinationCTokenAta],
    [splInterfacePda],
  ] = await Promise.all([
    getAssociatedTokenAccountAddress(mint, walletAddress, tokenProgram),
    getCtokenAta(walletAddress),
    getAssociatedTokenAccountAddress(mint, destination, tokenProgram),
    getCtokenAta(destination),
    getProgramDerivedAddress({
      seeds: getSplInterfaceSeeds(),
      programAddress: ctokenProgramAddress,
    }),
  ]);

  const [
    destinationSplAtaInfo,
    sourceSplAtaInfo,
    sourceCTokenAtaInfo,
    compressedSettings,
  ] = await Promise.all([
    fetchCachedAccountInfo(destinationSplAta, cachedAccounts),
    fetchCachedAccountInfo(sourceSplAta, cachedAccounts),
    fetchCachedAccountInfo(sourceCtokenAta, cachedAccounts),
    getCompressedSettings(
      compressed,
      index,
      settingsAddressTreeIndex,
      cachedAccounts,
    ),
  ]);

  const destinationSplExists = !!destinationSplAtaInfo.value;
  const sourceSplExists = !!sourceSplAtaInfo.value;
  const sourceCtokenExist = !!sourceCTokenAtaInfo.value;

  const splBalance = sourceSplExists
    ? getTokenDecoder().decode(
        getBase64Encoder().encode(sourceSplAtaInfo.value.data[0]),
      ).amount
    : BigInt(0);

  const cTokenBalance = sourceCtokenExist
    ? BigInt(
        parseTokenAmount(
          new Uint8Array(
            getBase64Encoder().encode(sourceCTokenAtaInfo.value!.data[0]),
          ),
        )?.amount ?? 0,
      )
    : BigInt(0);

  // Determine destination accounts (mutually exclusive)
  const destinationSplTokenAccount = destinationSplExists
    ? destinationSplAta
    : undefined;
  const destinationCtokenTokenAccount = destinationSplExists
    ? undefined
    : destinationCTokenAta;

  const requireSplInterface =
    (sourceSplExists &&
      (splBalance + cTokenBalance < BigInt(amount) ||
        cTokenBalance > BigInt(0) ||
        !destinationSplExists)) ||
    (!sourceSplExists && destinationSplExists);

  const requireRentSponsor = !destinationSplExists;

  const [compressedTokenAccounts, splInterfaceNeedsInitialization] =
    await Promise.all([
      getCompressedTokenAccounts(
        walletAddress,
        mint,
        splBalance,
        cTokenBalance,
        BigInt(amount),
        compressed ? 3 : 4,
      ),
      checkIfSplInterfaceNeedsToBeInitialized(
        requireSplInterface,
        splInterfacePda,
        cachedAccounts,
      ),
    ]);

  const compressedTotalBalance = compressedTokenAccounts.reduce(
    (balance, x) => balance + x.parsed.amount.toNumber(),
    0,
  );

  if (
    splBalance + cTokenBalance + BigInt(compressedTotalBalance) <
    BigInt(amount)
  ) {
    throw new Error("Insufficient balance");
  }

  let settingsMutArgs: SettingsMutArgs | null = null;
  let proof: ValidityProofWithContext | null = null;
  const packedAccounts = new PackedAccounts();

  if (splInterfaceNeedsInitialization) {
    packedAccounts.addPreAccounts([
      { address: mint, role: AccountRole.WRITABLE },
    ]);
  }

  if (compressedSettings || compressedTokenAccounts.length) {
    await packedAccounts.addSystemAccounts();
    const hashesWithTree: (HashWithTree & {
      data: CompressedAccount["data"];
      address: CompressedAccount["address"];
    })[] = [];
    if (compressedTokenAccounts.length) {
      hashesWithTree.push(
        ...compressedTokenAccounts.map((x) => ({
          hash: x.compressedAccount.hash,
          tree: x.compressedAccount.treeInfo.tree,
          queue: x.compressedAccount.treeInfo.queue,
          data: x.compressedAccount.data,
          address: x.compressedAccount.address,
        })),
      );
    }
    if (compressedSettings) {
      hashesWithTree.push(compressedSettings);
    }
    proof = await getValidityProofWithRetry(hashesWithTree, []);
    if (compressedSettings) {
      const start = compressedTokenAccounts.length;
      settingsMutArgs = getCompressedAccountMutArgs<CompressedSettings>(
        packedAccounts,
        proof.treeInfos.slice(start),
        proof.leafIndices.slice(start),
        proof.rootIndices.slice(start),
        proof.proveByIndices.slice(start),
        hashesWithTree.slice(start),
        getCompressedSettingsDecoder(),
      )[0];
    }
  }

  const sourceCompressedTokenAccounts: OptionOrNullable<
    CompressedTokenArgsArgs[]
  > =
    compressedTokenAccounts.length && proof
      ? some(
          compressedTokenAccounts.map((x, index) => ({
            isFrozen: x.parsed.state === AccountState.Frozen,
            hasDelegate: x.parsed.delegate != null,
            amount: x.parsed.amount.toNumber(),
            merkleContext: {
              leafIndex: x.compressedAccount.leafIndex,
              merkleTreePubkeyIndex: packedAccounts.insertOrGet(
                x.compressedAccount.treeInfo.tree.toString(),
              ),
              queuePubkeyIndex: packedAccounts.insertOrGet(
                x.compressedAccount.treeInfo.queue.toString(),
              ),
              proveByIndex: x.compressedAccount.proveByIndex,
            },
            rootIndex: proof.rootIndices[index],
            version: getVersionFromDiscriminator(
              x.compressedAccount.data?.discriminator,
            ),
            tlv: x.parsed.tlv
              ? some(
                  getArrayDecoder(getExtensionStructDecoder()).decode(
                    x.parsed.tlv,
                  ),
                )
              : none(),
          })),
        )
      : none();

  const secp256r1VerifyInput: Secp256r1VerifyInput = [];
  const secp256r1VerifyArgs: Secp256r1VerifyArgsWithDomainAddressArgs[] = [];
  for (const x of dedupSigners) {
    if (x instanceof SignedSecp256r1Key) {
      const index = secp256r1VerifyInput.length;
      const { domainConfig, verifyArgs, signature, publicKey, message } =
        await extractSecp256r1VerificationArgs(x, index);
      if (message && signature && publicKey) {
        secp256r1VerifyInput.push({ message, signature, publicKey });
      }
      if (domainConfig) {
        packedAccounts.addPreAccounts([
          { address: domainConfig, role: AccountRole.READONLY },
        ]);
        if (verifyArgs.__option === "Some") {
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

  const splInterfacePdaValue = requireSplInterface
    ? splInterfacePda
    : undefined;
  const rentSponsorValue = requireRentSponsor ? rentSponsor : undefined;
  const splInterfacePdaArgsValue: OptionOrNullable<SplInterfacePdaArgsArgs> =
    requireSplInterface ? some(splInterfacePdaArgs) : none();

  const commonParams = {
    amount,
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
    payer,
    sourceCompressedTokenAccounts,
    compressedProofArgs,
    compressibleConfig,
    splInterfacePda: splInterfacePdaValue,
    rentSponsor: rentSponsorValue,
    splInterfacePdaArgs: splInterfacePdaArgsValue,
  };

  if (compressed) {
    if (!settingsMutArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    instructions.push(
      getTokenTransferIntentCompressedInstruction({
        ...commonParams,
        settingsMutArgs,
      }),
    );
  } else {
    instructions.push(
      getTokenTransferIntentInstruction({
        ...commonParams,
        settings,
      }),
    );
  }

  return instructions;
}

async function checkIfSplInterfaceNeedsToBeInitialized(
  requireSplInterface: boolean,
  splInterfacePda: Address,
  cachedAccounts?: Map<string, any>,
) {
  if (!requireSplInterface) return false;
  const { value } = await fetchCachedAccountInfo(
    splInterfacePda,
    cachedAccounts,
  );
  return !value;
}

async function getCompressedTokenAccounts(
  walletAddress: string,
  mint: string,
  splBalance: bigint,
  cTokenBalance: bigint,
  total: bigint,
  maxInputs: number,
) {
  const transferAmount = total - splBalance - cTokenBalance;
  if (transferAmount <= 0) {
    return [];
  }
  const compressedResult =
    await getLightProtocolRpc().getCompressedTokenAccountsByOwner(
      new PublicKey(walletAddress),
      { mint: new PublicKey(mint) },
    );

  const accounts = compressedResult.items
    .filter(
      (x) =>
        !!x.compressedAccount.data?.data.length &&
        x.compressedAccount.owner.toString() ===
          ctokenProgramAddress.toString() &&
        !x.parsed.amount.isZero(),
    )
    .sort((a, b) => b.parsed.amount.cmp(a.parsed.amount));

  if (accounts.length === 0) {
    return [];
  }

  // Select accounts up to maxInputs or until we have enough balance
  let accumulatedAmount = BigInt(0);
  const selectedAccounts: ParsedTokenAccount[] = [];

  for (const account of accounts) {
    if (
      selectedAccounts.length >= maxInputs ||
      accumulatedAmount >= transferAmount
    ) {
      break;
    }
    accumulatedAmount += BigInt(account.parsed.amount.toNumber());
    selectedAccounts.push(account);
  }

  if (accumulatedAmount < transferAmount) {
    if (selectedAccounts.length >= maxInputs) {
      throw new Error(
        `Transaction size limit exceeded. Consider multiple transfers to transfer full balance.`,
      );
    }
    throw new Error(`Insufficient balance.`);
  }

  return selectedAccounts;
}

async function getCompressedSettings(
  compressed: boolean,
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: Map<string, any>,
) {
  if (!compressed) return null;
  const { address: settingsAddress } =
    await getCompressedSettingsAddressFromIndex(
      index,
      settingsAddressTreeIndex,
    );
  const settings = (
    await getCompressedAccountHashes(
      [{ address: settingsAddress, type: "Settings" }],
      cachedAccounts,
    )
  )[0];

  return settings;
}

function parseTokenAmount(data: Uint8Array<ArrayBuffer>): {
  amount: number | bigint;
} | null {
  if (!data || data.length === 0) return null;
  try {
    const amount = getU64Decoder().decode(data.slice(64, 72));
    return {
      amount,
    };
  } catch (error) {
    console.error("Token data parsing error:", error);
    return null;
  }
}
