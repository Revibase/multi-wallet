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
import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  type Address,
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
  map: Map<Address, MapData>;

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

  insertOrGet(pubkey: Address): number {
    return this.insertOrGetConfig(pubkey, AccountRole.WRITABLE);
  }

  insertOrGetConfig(pubkey: Address, role: AccountRole): number {
    if (!this.map.has(pubkey)) {
      const index = this.nextIndex++;
      const accountMeta: AccountMeta = {
        address: pubkey,
        role,
      };
      this.map.set(pubkey, { index, accountMeta });
    }
    return this.map.get(pubkey)!.index;
  }

  packOutputTreeIndex(outputStateTreeInfo: TreeInfo) {
    if (outputStateTreeInfo.treeType === TreeType.StateV1) {
      return this.insertOrGet(address(outputStateTreeInfo.tree.toString()));
    } else if (outputStateTreeInfo.treeType === TreeType.StateV2) {
      return this.insertOrGet(address(outputStateTreeInfo.queue.toString()));
    }
    throw new Error("Tree type not supported");
  }

  packTreeInfos(
    accountProofInputs: AccountProofInput[],
    newAddressProofInputs: NewAddressProofInput[]
  ): PackedTreeInfos {
    const stateTreeInfos: PackedStateTreeInfo[] = [];
    const addressTreeInfos: PackedAddressTreeInfo[] = [];
    let outputTreeIndex: number = -1;

    for (const account of accountProofInputs) {
      const merkleTreePubkeyIndex = this.insertOrGet(
        address(account.treeInfo.tree.toString())
      );
      const queuePubkeyIndex = this.insertOrGet(
        address(account.treeInfo.queue.toString())
      );

      stateTreeInfos.push({
        rootIndex: account.rootIndex,
        merkleTreePubkeyIndex,
        queuePubkeyIndex,
        leafIndex: account.leafIndex,
        proveByIndex: account.proveByIndex,
      });

      const treeToUse = account.treeInfo.nextTreeInfo ?? account.treeInfo;
      const index = this.packOutputTreeIndex(treeToUse);
      if (outputTreeIndex === -1) {
        outputTreeIndex = index;
      }
    }

    for (const account of newAddressProofInputs) {
      const addressMerkleTreePubkeyIndex = this.insertOrGet(
        address(account.treeInfo.tree.toString())
      );
      const addressQueuePubkeyIndex = this.insertOrGet(
        address(account.treeInfo.queue.toString())
      );

      addressTreeInfos.push({
        rootIndex: account.rootIndex,
        addressMerkleTreePubkeyIndex,
        addressQueuePubkeyIndex,
      });
    }

    return {
      stateTrees:
        stateTreeInfos.length > 0
          ? {
              packedTreeInfos: stateTreeInfos,
              outputTreeIndex,
            }
          : undefined,
      addressTrees: addressTreeInfos,
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
