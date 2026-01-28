import type { GetCompressedAccountsFilter } from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import {
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Base64EncodedBytes,
} from "gill";
import {
  base64URLStringToBuffer,
  fetchMaybeSettings,
  getCompressedSettingsAddressFromIndex,
  getCompressedSettingsDecoder,
  getMemberKeyEncoder,
  getSettingsDecoder,
  getUserAccountAddress,
  getUserDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
  Secp256r1Key,
  UserRole,
  type CompressedSettingsData,
  type User,
} from "../..";
import { NotFoundError, ValidationError } from "../../errors";
import type { AccountCache } from "../../types";
import { getSettingsFromIndex } from "../addresses";
import { getLightProtocolRpc, getSolanaRpc } from "../initialize";
import { convertPubkeyToMemberkey } from "../transaction/internal";
import { requireNonNegative } from "../validation";
import {
  fetchCachedCompressedAccount,
  getCachedWhitelistedAddressTree,
} from "./internal";

export async function fetchUserAccountData(
  member: Address | Secp256r1Key,
  userAddressTreeIndex?: number,
  cachedAccounts?: AccountCache,
): Promise<User> {
  const result = await fetchMaybeUserAccountData(
    member,
    userAddressTreeIndex,
    cachedAccounts,
  );
  if (!result) {
    throw new NotFoundError("User account");
  }
  return result;
}

export async function fetchMaybeUserAccountData(
  member: Address | Secp256r1Key,
  userAddressTreeIndex?: number,
  cachedAccounts?: AccountCache,
): Promise<User | null> {
  const { address } = await getUserAccountAddress(member, userAddressTreeIndex);
  const result = await fetchCachedCompressedAccount(address, cachedAccounts);
  if (!result?.data?.data) {
    return null;
  }
  return getUserDecoder().decode(result.data.data);
}

export async function fetchUserAccountByFilters(
  domainConfigAddress: Address,
  {
    member,
    credentialId,
  }: {
    member?: Address | Secp256r1Key | null;
    credentialId?: string | null;
  },
) {
  let filters: GetCompressedAccountsFilter[] = [
    {
      memcmp: {
        offset: 1,
        encoding: "base58",
        bytes: domainConfigAddress,
      },
    },
  ];
  if (member) {
    filters.push({
      memcmp: {
        offset: 33,
        encoding: "base58",
        bytes: getBase58Decoder().decode(
          getMemberKeyEncoder().encode(convertPubkeyToMemberkey(member)),
        ) as Base64EncodedBytes,
      },
    });
  } else if (credentialId) {
    filters.push({
      memcmp: {
        offset: 72,
        encoding: "base58",
        bytes: getBase58Decoder().decode(base64URLStringToBuffer(credentialId)),
      },
    });
  } else {
    return null;
  }
  const result = await getLightProtocolRpc().getCompressedAccountsByOwner(
    new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS.toString()),
    { filters },
  );
  if (!result.items.filter((x) => !!x.data).length) {
    return null;
  }
  return result.items.map((x) => getUserDecoder().decode(x.data?.data!))[0];
}

export async function fetchSettingsAccountData(
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: AccountCache,
): Promise<CompressedSettingsData & { isCompressed: boolean }> {
  const settingsData = await fetchMaybeSettingsAccountData(
    index,
    settingsAddressTreeIndex,
    cachedAccounts,
  );
  if (!settingsData) {
    throw new NotFoundError("Settings account");
  }
  return settingsData;
}

export async function fetchMaybeSettingsAccountData(
  index: number | bigint,
  settingsAddressTreeIndex?: number,
  cachedAccounts?: AccountCache,
): Promise<(CompressedSettingsData & { isCompressed: boolean }) | null> {
  try {
    const { address } = await getCompressedSettingsAddressFromIndex(
      index,
      settingsAddressTreeIndex,
    );
    const result = await fetchCachedCompressedAccount(address, cachedAccounts);
    if (!result?.data?.data) {
      throw new NotFoundError("Compressed settings account");
    }
    const data = getCompressedSettingsDecoder().decode(result.data.data);
    if (data.data.__option === "None") {
      throw new NotFoundError("Compressed settings account");
    }
    return { ...data.data.value, isCompressed: true };
  } catch {
    const result = await fetchMaybeSettings(
      getSolanaRpc(),
      await getSettingsFromIndex(index),
    );
    if (!result.exists) {
      return null;
    }
    return {
      ...result.data,
      isCompressed: false,
    };
  }
}

export async function fetchAllSettingsAccountByMember(
  member: Address | Secp256r1Key,
  userAddressTreeIndex?: number,
  cachedAccounts?: AccountCache,
) {
  const user = await fetchUserAccountData(
    member,
    userAddressTreeIndex,
    cachedAccounts,
  );
  if (
    user.role === UserRole.Administrator ||
    user.role === UserRole.TransactionManager
  ) {
    const settingsAccount: (CompressedSettingsData & {
      isCompressed: boolean;
    })[] = [];
    const [compressedAccounts, accounts] = await Promise.all([
      getLightProtocolRpc().getCompressedAccountsByOwner(
        new PublicKey(MULTI_WALLET_PROGRAM_ADDRESS.toString()),
        {
          filters: [
            {
              memcmp: {
                offset: 20,
                encoding: "base58",
                bytes: getBase58Decoder().decode(
                  getMemberKeyEncoder().encode(
                    convertPubkeyToMemberkey(member),
                  ),
                ),
              },
            },
          ],
        },
      ),
      getSolanaRpc()
        .getProgramAccounts(MULTI_WALLET_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: BigInt(20),
                encoding: "base64",
                bytes: getBase64Decoder().decode(
                  getMemberKeyEncoder().encode(
                    convertPubkeyToMemberkey(member),
                  ),
                ) as Base64EncodedBytes,
              },
            },
          ],
        })
        .send(),
    ]);
    compressedAccounts.items.forEach((x) => {
      if (x.data?.data) {
        const compressedData = getCompressedSettingsDecoder().decode(
          x.data.data,
        );
        if (compressedData.data.__option === "Some") {
          settingsAccount.push({
            ...compressedData.data.value,
            isCompressed: true,
          });
        }
      }
    });
    accounts.forEach((x) => {
      const data = getSettingsDecoder().decode(
        getBase64Encoder().encode(x.account.data[0]),
      );
      settingsAccount.push({ ...data, isCompressed: false });
    });
    return settingsAccount;
  } else {
    return await Promise.all(
      user.wallets.map((x) =>
        fetchSettingsAccountData(
          x.index,
          x.settingsAddressTreeIndex,
          cachedAccounts,
        ),
      ),
    );
  }
}

export async function getWhitelistedAddressTreeFromIndex(
  index: number,
): Promise<Address> {
  requireNonNegative(index, "index");
  const addressTrees = await getCachedWhitelistedAddressTree();
  if (index >= addressTrees.length) {
    throw new ValidationError(
      `Address tree index ${index} is out of bounds (max: ${addressTrees.length - 1})`,
    );
  }
  return addressTrees[index];
}

export async function getWhitelistedAddressTreeIndexFromAddress(
  addressTree: string,
): Promise<number> {
  const addressTrees = await getCachedWhitelistedAddressTree();
  const index = addressTrees.findIndex((x) => x.toString() === addressTree);
  if (index === -1) {
    throw new NotFoundError(
      "Address tree",
      `Address ${addressTree} not found in whitelist`,
    );
  }
  return index;
}
