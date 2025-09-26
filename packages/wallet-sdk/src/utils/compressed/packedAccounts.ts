import {
  type AccountProofInput,
  defaultStaticAccountsStruct,
  lightSystemProgram,
  type NewAddressProofInput,
  type PackedAddressTreeInfo,
  type PackedStateTreeInfo,
  type PackedTreeInfos,
  type TreeInfo,
  TreeType,
} from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";
import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  address,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS } from "gill/programs";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../../generated";
import { getLightCpiSigner } from "./internal";

interface MapData {
  index: number;
  accountMeta: AccountMeta;
}

export class PackedAccounts {
  preAccounts: AccountMeta[];
  systemAccounts: AccountMeta[];
  nextIndex: number;
  map: Map<PublicKey, MapData>;

  constructor() {
    this.preAccounts = [];
    this.systemAccounts = [];
    this.nextIndex = 0;
    this.map = new Map();
  }

  addPreAccounts(accounts: (AccountMeta | AccountSignerMeta)[]): void {
    this.preAccounts.push(...accounts);
  }

  async addSystemAccounts(): Promise<void> {
    const staticAccounts = defaultStaticAccountsStruct();
    this.systemAccounts.push(
      ...[
        lightSystemProgram,
        await getLightCpiSigner(),
        staticAccounts.registeredProgramPda,
        staticAccounts.noopProgram,
        staticAccounts.accountCompressionAuthority,
        staticAccounts.accountCompressionProgram,
        MULTI_WALLET_PROGRAM_ADDRESS,
        SYSTEM_PROGRAM_ADDRESS,
      ].map((x) => ({
        address: address(x.toString()),
        role: AccountRole.READONLY,
      }))
    );
  }

  insertOrGet(pubkey: PublicKey): number {
    return this.insertOrGetConfig(pubkey, AccountRole.WRITABLE);
  }

  insertOrGetConfig(pubkey: PublicKey, role: AccountRole): number {
    if (!this.map.has(pubkey)) {
      const index = this.nextIndex++;
      const accountMeta: AccountMeta = {
        address: address(pubkey.toString()),
        role,
      };
      this.map.set(pubkey, { index, accountMeta });
    }
    return this.map.get(pubkey)!.index;
  }

  packOutputTreeIndex(outputStateTreeInfo: TreeInfo): number | undefined {
    if (outputStateTreeInfo.treeType === TreeType.StateV1) {
      return this.insertOrGet(outputStateTreeInfo.tree);
    } else if (outputStateTreeInfo.treeType === TreeType.StateV2) {
      return this.insertOrGet(outputStateTreeInfo.queue);
    }
    return undefined;
  }

  packTreeInfos(
    accountProofInputs: AccountProofInput[],
    newAddressProofInputs: NewAddressProofInput[]
  ): PackedTreeInfos {
    const packedTreeInfos: PackedStateTreeInfo[] = [];
    const addressTrees: PackedAddressTreeInfo[] = [];
    let outputTreeIndex: number | undefined = undefined;

    if (accountProofInputs.length === 0 && newAddressProofInputs.length === 0) {
      return { stateTrees: undefined, addressTrees };
    }

    accountProofInputs.forEach((account) => {
      const merkleTreePubkeyIndex = this.insertOrGet(account.treeInfo.tree);
      const queuePubkeyIndex = this.insertOrGet(account.treeInfo.queue);

      packedTreeInfos.push({
        rootIndex: account.rootIndex,
        merkleTreePubkeyIndex,
        queuePubkeyIndex,
        leafIndex: account.leafIndex,
        proveByIndex: account.proveByIndex,
      });

      const treeToUse = account.treeInfo.nextTreeInfo ?? account.treeInfo;
      const index = this.packOutputTreeIndex(treeToUse);
      if (outputTreeIndex === undefined && index !== undefined) {
        outputTreeIndex = index;
      }
    });

    newAddressProofInputs.forEach((account) => {
      const addressMerkleTreePubkeyIndex = this.insertOrGet(
        account.treeInfo.tree
      );
      const addressQueuePubkeyIndex = this.insertOrGet(account.treeInfo.queue);

      addressTrees.push({
        rootIndex: account.rootIndex,
        addressMerkleTreePubkeyIndex,
        addressQueuePubkeyIndex,
      });
    });

    return {
      stateTrees:
        packedTreeInfos.length > 0
          ? {
              packedTreeInfos,
              outputTreeIndex: outputTreeIndex!,
            }
          : undefined,
      addressTrees,
    };
  }

  hashSetAccountsToMetas(): AccountMeta[] {
    const packedAccounts: AccountMeta[] = Array.from(this.map.entries())
      .sort((a, b) => a[1].index - b[1].index)
      .map(([, { accountMeta }]) => ({ ...accountMeta }));
    return packedAccounts;
  }

  getOffsets(): [number, number] {
    const systemAccountsStartOffset = this.preAccounts.length;
    const packedAccountsStartOffset =
      systemAccountsStartOffset + this.systemAccounts.length;
    return [systemAccountsStartOffset, packedAccountsStartOffset];
  }

  toAccountMetas(): {
    remainingAccounts: AccountMeta[];
    systemOffset: number;
    packedOffset: number;
  } {
    const packedAccounts = this.hashSetAccountsToMetas();
    const [systemOffset, packedOffset] = this.getOffsets();
    const remainingAccounts = [
      ...this.preAccounts,
      ...this.systemAccounts,
      ...packedAccounts,
    ];
    return { remainingAccounts, systemOffset, packedOffset };
  }
}
