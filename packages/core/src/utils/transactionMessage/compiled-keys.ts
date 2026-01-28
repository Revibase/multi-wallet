import { AccountRole, type Address, type Instruction } from "gill";

export type CompiledKeyMeta = {
  isSigner: boolean;
  isWritable: boolean;
  isInvoked: boolean;
};

type KeyMetaMap = Map<Address, CompiledKeyMeta>;

/** Adapted from solana-web3.js compiled-keys for wrapped vault transaction messages. @see https://github.com/solana-labs/solana-web3.js/blob/87d33ac68e2453b8a01cf8c425aa7623888434e8/packages/library-legacy/src/message/compiled-keys.ts */
export class CompiledKeys {
  payer: Address;
  keyMetaMap: KeyMetaMap;

  constructor(payer: Address, keyMetaMap: KeyMetaMap) {
    this.payer = payer;
    this.keyMetaMap = keyMetaMap;
  }

  static compile(
    instructions: Array<Instruction>,
    payer: Address
  ): CompiledKeys {
    const keyMetaMap: KeyMetaMap = new Map();
    const getOrInsertDefault = (address: Address): CompiledKeyMeta => {
      let keyMeta = keyMetaMap.get(address);
      if (keyMeta === undefined) {
        keyMeta = {
          isSigner: false,
          isWritable: false,
          isInvoked: false,
        };
        keyMetaMap.set(address, keyMeta);
      }
      return keyMeta;
    };

    const payerKeyMeta = getOrInsertDefault(payer);
    payerKeyMeta.isSigner = true;
    payerKeyMeta.isWritable = true;

    for (const ix of instructions) {
      getOrInsertDefault(ix.programAddress).isInvoked = false;
      for (const accountMeta of ix.accounts ?? []) {
        const keyMeta = getOrInsertDefault(accountMeta.address);
        keyMeta.isSigner ||=
          accountMeta.role === AccountRole.READONLY_SIGNER ||
          accountMeta.role === AccountRole.WRITABLE_SIGNER;
        keyMeta.isWritable ||=
          accountMeta.role === AccountRole.WRITABLE ||
          accountMeta.role === AccountRole.WRITABLE_SIGNER;
      }
    }

    return new CompiledKeys(payer, keyMetaMap);
  }

  getMessageComponents(): [
    {
      numReadonlyNonSignerAccounts: number;
      numReadonlySignerAccounts: number;
      numSignerAccounts: number;
    },
    Array<Address>,
  ] {
    const mapEntries = [...this.keyMetaMap.entries()];
    if (mapEntries.length > 256) {
      throw new Error("Max static account keys length exceeded");
    }

    const writableSigners = mapEntries.filter(
      ([, meta]) => meta.isSigner && meta.isWritable
    );
    const readonlySigners = mapEntries.filter(
      ([, meta]) => meta.isSigner && !meta.isWritable
    );
    const writableNonSigners = mapEntries.filter(
      ([, meta]) => !meta.isSigner && meta.isWritable
    );
    const readonlyNonSigners = mapEntries.filter(
      ([, meta]) => !meta.isSigner && !meta.isWritable
    );

    const header = {
      numSignerAccounts: writableSigners.length + readonlySigners.length,
      numReadonlySignerAccounts: readonlySigners.length,
      numReadonlyNonSignerAccounts: readonlyNonSigners.length,
    };

    if (writableSigners.length === 0) {
      throw new Error("Expected at least one writable signer key");
    }

    const [payerAddress] = writableSigners[0];
    if (payerAddress !== this.payer) {
      throw new Error(
        "Expected first writable signer key to be the fee payer"
      );
    }

    const staticAccountKeys = [
      ...writableSigners.map(([key]) => key),
      ...readonlySigners.map(([key]) => key),
      ...writableNonSigners.map(([key]) => key),
      ...readonlyNonSigners.map(([key]) => key),
    ];

    return [header, staticAccountKeys];
  }

  extractTableLookup(lookupTableAddresses: [string, Address[]]) {
    const [writableIndexes, drainedWritableKeys] =
      this.drainKeysFoundInLookupTable(
        lookupTableAddresses[1],
        (keyMeta) =>
          !keyMeta.isSigner && !keyMeta.isInvoked && keyMeta.isWritable
      );
    const [readonlyIndexes, drainedReadonlyKeys] =
      this.drainKeysFoundInLookupTable(
        lookupTableAddresses[1],
        (keyMeta) =>
          !keyMeta.isSigner && !keyMeta.isInvoked && !keyMeta.isWritable
      );

    if (writableIndexes.length === 0 && readonlyIndexes.length === 0) {
      return;
    }

    return {
      addressTableLookup: {
        lookupTableAddress: lookupTableAddresses[0],
        writableIndexes,
        readonlyIndexes,
      },
      drainedKeys: {
        writable: drainedWritableKeys,
        readonly: drainedReadonlyKeys,
      },
    };
  }

  private drainKeysFoundInLookupTable(
    lookupTableEntries: Array<Address>,
    keyMetaFilter: (keyMeta: CompiledKeyMeta) => boolean
  ): [Array<number>, Array<Address>] {
    const lookupTableIndexes = new Array();
    const drainedKeys = new Array();

    for (const [addressKey, keyMeta] of this.keyMetaMap.entries()) {
      if (keyMetaFilter(keyMeta)) {
        const key = addressKey;
        const lookupTableIndex = lookupTableEntries.findIndex(
          (entry) => entry === key
        );
        if (lookupTableIndex >= 0) {
          if (lookupTableIndex >= 256) {
            throw new Error("Max lookup table index exceeded");
          }
          lookupTableIndexes.push(lookupTableIndex);
          drainedKeys.push(key);
          this.keyMetaMap.delete(addressKey);
        }
      }
    }

    return [lookupTableIndexes, drainedKeys];
  }
}
