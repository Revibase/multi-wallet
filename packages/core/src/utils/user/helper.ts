import {
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Base64EncodedBytes,
  type GetProgramAccountsMemcmpFilter,
} from "@solana/kit";
import {
  fetchSettings,
  fetchUser,
  getMemberKeyEncoder,
  getSettingsDecoder,
  getUserDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
  UserRole,
  type Settings,
} from "../../generated";
import type { Secp256r1Key } from "../../types";
import { getSettingsFromIndex, getUserAddress } from "../addresses";
import { getSolanaRpc } from "../initialize";
import { base64URLStringToBuffer } from "../passkeys/helper";
import { convertPubkeyToMemberkey } from "../transaction/internal";

/** Anchor account discriminator size. */
const ACCOUNT_DISCRIMINATOR_SIZE = 8;
/** `Option<Address>` tag byte when `Some`. */
const OPTION_SOME_TAG = 1;
/** Serialized `MemberKey` size. */
const MEMBER_KEY_SIZE = 34;
/** `Option<Vec<u8>>` length prefix size (tag + u32 len). */
const OPTION_VEC_PREFIX_SIZE = 5;

const USER_DOMAIN_CONFIG_OFFSET = ACCOUNT_DISCRIMINATOR_SIZE + OPTION_SOME_TAG;
const USER_MEMBER_OFFSET = ACCOUNT_DISCRIMINATOR_SIZE + OPTION_SOME_TAG + 32;
const USER_CREDENTIAL_ID_OFFSET =
  USER_MEMBER_OFFSET + MEMBER_KEY_SIZE + OPTION_VEC_PREFIX_SIZE;
const SETTINGS_MEMBER_OFFSET = 20;

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
  let filters: GetProgramAccountsMemcmpFilter[] = [
    {
      memcmp: {
        offset: BigInt(USER_DOMAIN_CONFIG_OFFSET),
        encoding: "base64",
        bytes: getBase64Decoder().decode(
          getAddressEncoder().encode(domainConfigAddress),
        ) as Base64EncodedBytes,
      },
    },
  ];
  if (member) {
    filters.push({
      memcmp: {
        offset: BigInt(USER_MEMBER_OFFSET),
        encoding: "base64",
        bytes: getBase64Decoder().decode(
          getMemberKeyEncoder().encode(convertPubkeyToMemberkey(member)),
        ) as Base64EncodedBytes,
      },
    });
  } else if (credentialId) {
    filters.push({
      memcmp: {
        offset: BigInt(USER_CREDENTIAL_ID_OFFSET),
        encoding: "base64",
        bytes: getBase64Decoder().decode(
          base64URLStringToBuffer(credentialId),
        ) as Base64EncodedBytes,
      },
    });
  } else {
    return null;
  }

  const result = await getSolanaRpc()
    .getProgramAccounts(MULTI_WALLET_PROGRAM_ADDRESS, {
      filters,
      encoding: "base64",
    })
    .send();

  if (!result.length) {
    return null;
  }
  return result.map((x) =>
    getUserDecoder().decode(getBase64Encoder().encode(x.account.data[0])),
  )[0];
}

export async function fetchAllSettingsAccountByMember(
  member: Address | Secp256r1Key,
) {
  const user = (await fetchUser(getSolanaRpc(), await getUserAddress(member)))
    .data;
  if (
    user.role === UserRole.Administrator ||
    user.role === UserRole.TransactionManager
  ) {
    const settingsAccount: Settings[] = [];
    const accounts = await getSolanaRpc()
      .getProgramAccounts(MULTI_WALLET_PROGRAM_ADDRESS, {
        encoding: "base64",
        filters: [
          {
            memcmp: {
              offset: BigInt(SETTINGS_MEMBER_OFFSET),
              encoding: "base64",
              bytes: getBase64Decoder().decode(
                getMemberKeyEncoder().encode(convertPubkeyToMemberkey(member)),
              ) as Base64EncodedBytes,
            },
          },
        ],
      })
      .send();

    accounts.forEach((x) => {
      const data = getSettingsDecoder().decode(
        getBase64Encoder().encode(x.account.data[0]),
      );
      settingsAccount.push({ ...data });
    });
    return settingsAccount;
  } else {
    return await Promise.all(
      user.wallets.map(
        async (x) =>
          (
            await fetchSettings(
              getSolanaRpc(),
              await getSettingsFromIndex(x.index),
            )
          ).data,
      ),
    );
  }
}
