import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  address,
} from "@solana/kit";

interface MapData {
  index: number;
  accountMeta: AccountMeta;
}

export class PackedAccounts {
  nextPreIndex: number;
  preMap: Map<string, MapData>;

  constructor() {
    this.nextPreIndex = 0;
    this.preMap = new Map();
  }

  addPreAccounts(
    accounts: (AccountMeta | AccountSignerMeta)[],
  ): Map<string, MapData> {
    for (const acc of accounts) {
      this.insertOrGet(acc.address.toString(), acc);
    }
    return this.preMap;
  }

  getAccountRole(isSigner: boolean, isWritable: boolean): AccountRole {
    if (isSigner) {
      return isWritable
        ? AccountRole.WRITABLE_SIGNER
        : AccountRole.READONLY_SIGNER;
    } else {
      return isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
    }
  }

  insertOrGet(
    pubkey: string,
    accountMeta: AccountMeta | AccountSignerMeta = {
      address: address(pubkey),
      role: AccountRole.WRITABLE,
    },
  ): number {
    const map = this.preMap;
    if (!map.has(pubkey)) {
      const index = this.nextPreIndex++;
      map.set(pubkey, { index, accountMeta });
    }
    return map.get(pubkey)!.index;
  }

  hashSetAccountsToMetas(map: Map<string, MapData>): AccountMeta[] {
    const packedAccounts: AccountMeta[] = Array.from(map.entries())
      .sort((a, b) => a[1].index - b[1].index)
      .map(([, { accountMeta }]) => ({ ...accountMeta }));
    return packedAccounts;
  }

  toAccountMetas(): {
    remainingAccounts: AccountMeta[];
  } {
    const preAccounts = this.hashSetAccountsToMetas(this.preMap);

    return { remainingAccounts: preAccounts };
  }
}
